// API Configuration
const API_URL = 'http://localhost:3000/api';

// State Management
let currentPage = 'dashboard';
let products = [];
let movements = [];
let charts = {};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadDashboard();
});

// Event Listeners
function initializeEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  // Dashboard
  document.getElementById('btn-new-product').addEventListener('click', openProductModal);

  // Products
  document.getElementById('product-form').addEventListener('submit', saveProduct);
  document.getElementById('btn-cancel').addEventListener('click', closeProductModal);

  // Movements
  document.getElementById('btn-entrada').addEventListener('click', () => openMovementModal('entrada'));
  document.getElementById('btn-saida').addEventListener('click', () => openMovementModal('saída'));
  document.getElementById('movement-form').addEventListener('submit', saveMovement);
  document.getElementById('btn-cancel-movement').addEventListener('click', closeMovementModal);

  // Reports
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

  // Modal Close
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.modal').classList.remove('active');
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', handleSearch);
}

// Navigation
function navigateTo(page) {
  currentPage = page;
  
  // Update active nav link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Update page title
  const titles = {
    dashboard: '📊 Dashboard',
    products: '📦 Produtos',
    movements: '↔️ Movimentações',
    reports: '📈 Relatórios',
    settings: '⚙️ Configurações'
  };
  document.getElementById('page-title').textContent = titles[page];

  // Hide all pages, show active
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`${page}-page`).classList.add('active');

  // Load page content
  switch(page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'products':
      loadProducts();
      break;
    case 'movements':
      loadMovements();
      break;
    case 'reports':
      loadReports();
      break;
    case 'settings':
      // Settings page doesn't need loading
      break;
  }
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    // Load summary stats
    const response = await fetch(`${API_URL}/reports/summary`);
    const stats = await response.json();

    // Update stat cards
    const totalProducts = stats.find(s => s.metric === 'Total de Produtos');
    const totalValue = stats.find(s => s.metric === 'Valor Total em Estoque');
    const lowStock = stats.find(s => s.metric === 'Produtos com Estoque Baixo');
    const movements30 = stats.find(s => s.metric === 'Movimentações (últimos 30 dias)');

    document.getElementById('total-products').textContent = totalProducts?.value || 0;
    document.getElementById('total-value').textContent = `R$ ${(totalValue?.value || 0).toFixed(2)}`;
    document.getElementById('low-stock').textContent = lowStock?.value || 0;
    document.getElementById('movements-30').textContent = movements30?.value || 0;

    // Load charts
    await loadCategoryChart();
    await loadMovementChart();
    await loadLowStockTable();
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
    showAlert('Erro ao carregar dashboard', 'danger');
  }
}

async function loadCategoryChart() {
  try {
    const response = await fetch(`${API_URL}/reports/by-category`);
    const data = await response.json();

    const ctx = document.getElementById('categoryChart').getContext('2d');
    
    // Destroy existing chart if exists
    if (charts.category) charts.category.destroy();

    charts.category = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.category),
        datasets: [{
          data: data.map(d => d.product_count),
          backgroundColor: [
            '#667eea',
            '#764ba2',
            '#f093fb',
            '#4facfe',
            '#00f2fe'
          ],
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  } catch (error) {
    console.error('Erro ao carregar gráfico de categorias:', error);
  }
}

async function loadMovementChart() {
  try {
    const response = await fetch(`${API_URL}/reports/history`);
    const data = await response.json();

    const ctx = document.getElementById('movementChart').getContext('2d');
    
    // Destroy existing chart if exists
    if (charts.movement) charts.movement.destroy();

    charts.movement = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.reverse().map(d => d.date),
        datasets: [
          {
            label: 'Entradas',
            data: data.map(d => d.entradas),
            borderColor: '#27ae60',
            backgroundColor: 'rgba(39, 174, 96, 0.1)',
            tension: 0.3,
            fill: true
          },
          {
            label: 'Saídas',
            data: data.map(d => d.saidas),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231, 76, 60, 0.1)',
            tension: 0.3,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom'
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  } catch (error) {
    console.error('Erro ao carregar gráfico de movimentações:', error);
  }
}

async function loadLowStockTable() {
  try {
    const response = await fetch(`${API_URL}/products/stats/summary`);
    const products = await fetch(`${API_URL}/products`).then(r => r.json());
    
    const lowStockProducts = products.filter(p => p.quantity <= p.min_quantity);
    const tbody = document.querySelector('#low-stock-table tbody');
    tbody.innerHTML = '';

    lowStockProducts.slice(0, 5).forEach(product => {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${product.name}</td>
        <td>${product.sku || 'N/A'}</td>
        <td>${product.quantity}</td>
        <td>${product.min_quantity}</td>
        <td>
          <button class="btn btn-primary" onclick="openMovementModal('entrada', ${product.id})">
            Repor
          </button>
        </td>
      `;
    });

    if (lowStockProducts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum produto com estoque baixo</td></tr>';
    }
  } catch (error) {
    console.error('Erro ao carregar tabela de estoque baixo:', error);
  }
}

// ===== PRODUCTS =====
async function loadProducts() {
  try {
    const response = await fetch(`${API_URL}/products`);
    products = await response.json();
    renderProductsTable();
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
    showAlert('Erro ao carregar produtos', 'danger');
  }
}

function renderProductsTable() {
  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';

  products.forEach(product => {
    const status = product.quantity <= product.min_quantity 
      ? '<span class="status critical">Crítico</span>'
      : product.quantity <= product.min_quantity * 1.5
      ? '<span class="status low">Baixo</span>'
      : '<span class="status ok">OK</span>';

    const row = tbody.insertRow();
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.sku || 'N/A'}</td>
      <td>${product.category_name || 'Outros'}</td>
      <td>${product.quantity}</td>
      <td>R$ ${product.price.toFixed(2)}</td>
      <td>${status}</td>
      <td>
        <button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="editProduct(${product.id})">Editar</button>
        <button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" onclick="deleteProduct(${product.id})">Remover</button>
      </td>
    `;
  });
}

function openProductModal(productId = null) {
  const modal = document.getElementById('product-modal');
  const form = document.getElementById('product-form');
  
  if (productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
      document.getElementById('modal-title').textContent = 'Editar Produto';
      document.getElementById('product-id').value = product.id;
      document.getElementById('product-name').value = product.name;
      document.getElementById('product-sku').value = product.sku || '';
      document.getElementById('product-description').value = product.description || '';
      document.getElementById('product-category').value = product.category_id || 5;
      document.getElementById('product-quantity').value = product.quantity;
      document.getElementById('product-min-quantity').value = product.min_quantity;
      document.getElementById('product-price').value = product.price;
    }
  } else {
    document.getElementById('modal-title').textContent = 'Novo Produto';
    form.reset();
    document.getElementById('product-id').value = '';
  }
  
  modal.classList.add('active');
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('active');
}

async function saveProduct(e) {
  e.preventDefault();

  const id = document.getElementById('product-id').value;
  const data = {
    name: document.getElementById('product-name').value,
    sku: document.getElementById('product-sku').value,
    description: document.getElementById('product-description').value,
    category_id: document.getElementById('product-category').value,
    quantity: parseInt(document.getElementById('product-quantity').value),
    min_quantity: parseInt(document.getElementById('product-min-quantity').value),
    price: parseFloat(document.getElementById('product-price').value)
  };

  try {
    const url = id ? `${API_URL}/products/${id}` : `${API_URL}/products`;
    const method = id ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showAlert(id ? 'Produto atualizado com sucesso' : 'Produto criado com sucesso', 'success');
      closeProductModal();
      loadProducts();
    } else {
      showAlert('Erro ao salvar produto', 'danger');
    }
  } catch (error) {
    console.error('Erro ao salvar produto:', error);
    showAlert('Erro ao salvar produto', 'danger');
  }
}

function editProduct(id) {
  openProductModal(id);
}

async function deleteProduct(id) {
  if (confirm('Tem certeza que deseja remover este produto?')) {
    try {
      const response = await fetch(`${API_URL}/products/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showAlert('Produto removido com sucesso', 'success');
        loadProducts();
      } else {
        showAlert('Erro ao remover produto', 'danger');
      }
    } catch (error) {
      console.error('Erro ao remover produto:', error);
      showAlert('Erro ao remover produto', 'danger');
    }
  }
}

// ===== MOVEMENTS =====
async function loadMovements() {
  try {
    const response = await fetch(`${API_URL}/movements`);
    movements = await response.json();
    renderMovementsTable();
  } catch (error) {
    console.error('Erro ao carregar movimentações:', error);
    showAlert('Erro ao carregar movimentações', 'danger');
  }
}

function renderMovementsTable() {
  const tbody = document.querySelector('#movements-table tbody');
  tbody.innerHTML = '';

  movements.forEach(movement => {
    const date = new Date(movement.created_at).toLocaleDateString('pt-BR');
    const type = movement.type === 'entrada' 
      ? '<span style="color: #27ae60; font-weight: bold;">+ Entrada</span>'
      : '<span style="color: #e74c3c; font-weight: bold;">- Saída</span>';

    const row = tbody.insertRow();
    row.innerHTML = `
      <td>${date}</td>
      <td>${movement.product_name}</td>
      <td>${movement.sku}</td>
      <td>${type}</td>
      <td>${movement.quantity}</td>
      <td>${movement.reason || '-'}</td>
      <td>${movement.notes || '-'}</td>
    `;
  });

  if (movements.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Nenhuma movimentação registrada</td></tr>';
  }
}

function openMovementModal(type, productId = null) {
  const modal = document.getElementById('movement-modal');
  document.getElementById('movement-type').value = type;
  document.getElementById('movement-modal-title').textContent = 
    type === 'entrada' ? 'Registrar Entrada' : 'Registrar Saída';

  // Load products
  loadProductsForSelect();

  if (productId) {
    document.getElementById('movement-product').value = productId;
  }

  modal.classList.add('active');
}

function closeMovementModal() {
  document.getElementById('movement-modal').classList.remove('active');
  document.getElementById('movement-form').reset();
}

async function loadProductsForSelect() {
  try {
    const response = await fetch(`${API_URL}/products`);
    const products = await response.json();
    
    const select = document.getElementById('movement-product');
    select.innerHTML = '<option value="">Selecione um produto</option>';
    
    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = `${product.name} (Qtd: ${product.quantity})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
  }
}

async function saveMovement(e) {
  e.preventDefault();

  const type = document.getElementById('movement-type').value;
  const data = {
    product_id: parseInt(document.getElementById('movement-product').value),
    quantity: parseInt(document.getElementById('movement-quantity').value),
    reason: document.getElementById('movement-reason').value,
    notes: document.getElementById('movement-notes').value
  };

  try {
    const endpoint = type === 'entrada' ? 'entrada' : 'saida';
    const response = await fetch(`${API_URL}/movements/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showAlert('Movimentação registrada com sucesso', 'success');
      closeMovementModal();
      loadMovements();
      if (currentPage === 'dashboard') loadDashboard();
    } else {
      const error = await response.json();
      showAlert(error.error || 'Erro ao registrar movimentação', 'danger');
    }
  } catch (error) {
    console.error('Erro ao registrar movimentação:', error);
    showAlert('Erro ao registrar movimentação', 'danger');
  }
}

// ===== REPORTS =====
async function loadReports() {
  try {
    const response = await fetch(`${API_URL}/reports/top-products`);
    const topProducts = await response.json();
    renderTopProductsTable(topProducts);
  } catch (error) {
    console.error('Erro ao carregar relatórios:', error);
    showAlert('Erro ao carregar relatórios', 'danger');
  }
}

function renderTopProductsTable(topProducts) {
  const tbody = document.querySelector('#top-products-table tbody');
  tbody.innerHTML = '';

  topProducts.forEach(product => {
    const row = tbody.insertRow();
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.movement_count}</td>
      <td>${product.total_entradas || 0}</td>
      <td>${product.total_saidas || 0}</td>
    `;
  });

  if (topProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Nenhum dado disponível</td></tr>';
  }
}

function exportPDF() {
  window.location.href = `${API_URL}/reports/export/pdf`;
}

function exportCSV() {
  window.location.href = `${API_URL}/reports/export/csv`;
}

// ===== UTILITIES =====
function showAlert(message, type = 'info') {
  // You can implement a toast notification here
  console.log(`[${type.toUpperCase()}] ${message}`);
  alert(message);
}

function handleSearch() {
  const query = document.getElementById('search-input').value.toLowerCase();
  
  if (currentPage === 'products') {
    const filtered = products.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.sku && p.sku.toLowerCase().includes(query))
    );
    // Render filtered products
    const tbody = document.querySelector('#products-table tbody');
    tbody.innerHTML = '';
    filtered.forEach(product => {
      const status = product.quantity <= product.min_quantity 
        ? '<span class="status critical">Crítico</span>'
        : '<span class="status ok">OK</span>';
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${product.name}</td>
        <td>${product.sku || 'N/A'}</td>
        <td>${product.category_name}</td>
        <td>${product.quantity}</td>
        <td>R$ ${product.price.toFixed(2)}</td>
        <td>${status}</td>
        <td>
          <button class="btn btn-primary" onclick="editProduct(${product.id})">Editar</button>
          <button class="btn btn-danger" onclick="deleteProduct(${product.id})">Remover</button>
        </td>
      `;
    });
  }
}
