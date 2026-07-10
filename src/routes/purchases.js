const express = require('express');
const db = require('../database');
const { authMiddleware, authorize } = require('../auth');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// GET - Listar pedidos de compra
router.get('/', authMiddleware, async (req, res) => {
  try {
    const status = req.query.status;
    let query = `
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE po.status = ?';
      params.push(status);
    }

    query += ' ORDER BY po.order_date DESC';
    const orders = await db.all(query, params);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Obter pedido específico
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const order = await db.get(`
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = ?
    `, [req.params.id]);

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Obter itens do pedido
    const items = await db.all(`
      SELECT pi.*, p.name as product_name, p.sku
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_order_id = ?
    `, [req.params.id]);

    order.items = items;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Criar pedido de compra
router.post('/', authMiddleware, authorize('admin', 'gerente', 'comprador'), async (req, res) => {
  try {
    const { supplier_id, expected_delivery, items, notes } = req.body;

    if (!supplier_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Fornecedor e itens são obrigatórios' });
    }

    const order_number = `PO-${Date.now()}`;
    let total_amount = 0;

    // Calcular total
    for (let item of items) {
      total_amount += item.quantity_ordered * item.unit_price;
    }

    // Criar pedido
    const result = await db.run(
      `INSERT INTO purchase_orders (order_number, supplier_id, order_date, expected_delivery, total_amount, notes, created_by)
       VALUES (?, ?, DATE('now'), ?, ?, ?, ?)`,
      [order_number, supplier_id, expected_delivery || null, total_amount, notes || null, req.user.id]
    );

    const order_id = result.id;

    // Adicionar itens
    for (let item of items) {
      const subtotal = item.quantity_ordered * item.unit_price;
      await db.run(
        `INSERT INTO purchase_items (purchase_order_id, product_id, quantity_ordered, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [order_id, item.product_id, item.quantity_ordered, item.unit_price, subtotal]
      );
    }

    res.status(201).json({ 
      message: 'Pedido de compra criado com sucesso',
      id: order_id,
      order_number 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT - Atualizar status do pedido
router.put('/:id/status', authMiddleware, authorize('admin', 'gerente', 'comprador'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pendente', 'confirmado', 'enviado', 'recebido', 'cancelado'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    await db.run(
      'UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, req.params.id]
    );

    res.json({ message: `Pedido atualizado para ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Receber pedido
router.post('/:id/receive', authMiddleware, authorize('admin', 'gerente', 'operador'), async (req, res) => {
  try {
    const { items_received, invoice_number } = req.body;

    if (!items_received) {
      return res.status(400).json({ error: 'Itens recebidos são obrigatórios' });
    }

    const order = await db.get('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Atualizar itens recebidos
    for (let item of items_received) {
      await db.run(
        `UPDATE purchase_items 
         SET quantity_received = quantity_received + ? 
         WHERE purchase_order_id = ? AND product_id = ?`,
        [item.quantity, req.params.id, item.product_id]
      );

      // Atualizar inventário
      await db.run(
        `UPDATE inventory 
         SET quantity_available = quantity_available + ? 
         WHERE product_id = ?`,
        [item.quantity, item.product_id]
      );

      // Atualizar quantidade do produto
      await db.run(
        `UPDATE products 
         SET quantity_current = quantity_current + ? 
         WHERE id = ?`,
        [item.quantity, item.product_id]
      );

      // Registrar movimento
      await db.run(
        `INSERT INTO movements (product_id, type, quantity, reason, reference_id, reference_type, created_by)
         VALUES (?, 'entrada', ?, 'Recebimento de pedido de compra', ?, 'purchase_order', ?)`,
        [item.product_id, item.quantity, req.params.id, req.user.id]
      );
    }

    // Registrar nota fiscal se fornecida
    if (invoice_number) {
      await db.run(
        `INSERT INTO invoices (number, purchase_order_id, supplier_id, receipt_date)
         VALUES (?, ?, ?, DATE('now'))`,
        [invoice_number, req.params.id, order.supplier_id]
      );
    }

    // Atualizar status
    await db.run(
      'UPDATE purchase_orders SET status = ?, actual_delivery = DATE("now"), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['recebido', req.params.id]
    );

    res.json({ message: 'Pedido recebido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Previsão de abastecimento
router.get('/forecast/needed', authMiddleware, async (req, res) => {
  try {
    const forecast = await db.all(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.quantity_current,
        p.quantity_min,
        p.quantity_max,
        p.supplier_id,
        s.name as supplier_name,
        p.lead_time_days,
        (p.quantity_max - p.quantity_current) as suggest_order_quantity
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.quantity_current <= p.quantity_min
      ORDER BY (p.quantity_min - p.quantity_current) DESC
    `);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
