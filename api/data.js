// ============================================
// EuroSales CRM - 数据API
// 支持 IGA Pages 云函数部署
// ============================================

const fs = require('fs');
const path = require('path');

// 数据文件路径（使用可写目录）
const DATA_DIR = process.env.IGA_DATA_DIR || path.join(__dirname, '..', '.data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取 JSON 文件
function readJSON(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('读取文件失败:', filePath, e.message);
  }
  return defaultValue;
}

// 写入 JSON 文件
function writeJSON(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 初始化默认用户（带账号密码，首次登录需改密码）
function getDefaultUsers() {
  return [
    { id: 1, name: '主管理员', role: 'manager', avatar: '主', username: 'admin', password: 'admin123', mustChangePassword: true }
  ];
}

// 返回用户列表时隐藏密码
function getUsersSafe() {
  const users = getUsers();
  return users.map(u => {
    const { password, ...safe } = u;
    return safe;
  });
}

// ============================================
// 获取所有数据
// ============================================
function getCustomers() {
  return readJSON(CUSTOMERS_FILE, []);
}

function getActivities() {
  return readJSON(ACTIVITIES_FILE, []);
}

function getUsers() {
  let users = readJSON(USERS_FILE, null);
  if (!users || !Array.isArray(users) || users.length === 0) {
    users = getDefaultUsers();
    saveUsers(users);
  }
  return users;
}

function saveCustomers(data) {
  writeJSON(CUSTOMERS_FILE, data);
}

function saveActivities(data) {
  writeJSON(ACTIVITIES_FILE, data);
}

function saveUsers(data) {
  writeJSON(USERS_FILE, data);
}

// ============================================
// 辅助函数
// ============================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() {
  return new Date().toISOString();
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
  });
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// ============================================
// 请求路由
// ============================================
async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.replace(/\/api\/?/, '').split('/').filter(Boolean);
  const resource = pathParts[0] || '';

  try {
    switch (resource) {
      // ========== 客户 CRUD ==========
      case 'customers': {
        const customers = getCustomers();
        if (req.method === 'GET') {
          return sendJSON(res, customers);
        }
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (body.action === 'delete') {
            const filtered = customers.filter(c => c.id !== body.id);
            saveCustomers(filtered);
            return sendJSON(res, { success: true });
          }
          if (body.id) {
            // 更新
            const idx = customers.findIndex(c => c.id === body.id);
            if (idx >= 0) {
              customers[idx] = { ...customers[idx], ...body, updatedAt: now() };
              saveCustomers(customers);
              return sendJSON(res, { success: true, customer: customers[idx] });
            }
            return sendJSON(res, { error: '客户不存在' }, 404);
          } else {
            // 新增
            const newC = {
              id: genId(),
              ...body,
              createdAt: now(),
              updatedAt: now()
            };
            customers.push(newC);
            saveCustomers(customers);
            return sendJSON(res, { success: true, customer: newC });
          }
        }
        break;
      }

      // ========== 活动记录 ==========
      case 'activities': {
        let activities = getActivities();
        if (req.method === 'GET') {
          return sendJSON(res, activities);
        }
        if (req.method === 'POST') {
          const body = await parseBody(req);
          activities.push({ ...body, time: now() });
          if (activities.length > 200) activities = activities.slice(-200);
          saveActivities(activities);
          return sendJSON(res, { success: true });
        }
        break;
      }

      // ========== 登录 ==========
      case 'login': {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (!body.username || !body.password) {
            return sendJSON(res, { error: '请输入账号和密码' }, 400);
          }
          const users = getUsers();
          const user = users.find(u => u.username === body.username && u.password === body.password);
          if (!user) {
            return sendJSON(res, { error: '账号或密码错误' }, 401);
          }
          const { password, ...safeUser } = user;
          return sendJSON(res, { success: true, user: safeUser });
        }
        break;
      }

      // ========== 修改密码 ==========
      case 'change-password': {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (!body.id || !body.newPassword) {
            return sendJSON(res, { error: '参数不完整' }, 400);
          }
          if (body.newPassword.length < 4) {
            return sendJSON(res, { error: '密码至少4位' }, 400);
          }
          const users = getUsers();
          const u = users.find(u => u.id === body.id);
          if (!u) return sendJSON(res, { error: '用户不存在' }, 404);
          if (body.oldPassword && u.password !== body.oldPassword) {
            return sendJSON(res, { error: '原密码错误' }, 400);
          }
          u.password = body.newPassword;
          u.mustChangePassword = false;
          saveUsers(users);
          const { password, ...safeUser } = u;
          return sendJSON(res, { success: true, user: safeUser });
        }
        break;
      }

      // ========== 重置管理员密码 ==========
      case 'reset-admin': {
        if (req.method === 'POST') {
          const users = getUsers();
          const admin = users.find(u => u.id === 1);
          if (admin) {
            admin.password = 'admin123';
            admin.mustChangePassword = true;
            saveUsers(users);
            return sendJSON(res, { success: true });
          }
          return sendJSON(res, { error: '管理员用户不存在' }, 404);
        }
        break;
      }

      // ========== 用户管理 ==========
      case 'users': {
        let users = getUsers();
        if (req.method === 'GET') {
          return sendJSON(res, getUsersSafe());
        }
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (body.action === 'add') {
            if (!body.name) return sendJSON(res, { error: '姓名不能为空' }, 400);
            if (!body.username) return sendJSON(res, { error: '账号不能为空' }, 400);
            if (!body.password) return sendJSON(res, { error: '密码不能为空' }, 400);
            // 检查账号是否重复
            if (users.find(u => u.username === body.username)) {
              return sendJSON(res, { error: '账号已存在，请使用其他账号名' }, 400);
            }
            const role = body.role === 'manager' ? 'manager' : 'sales';
            const maxId = Math.max(...users.map(u => u.id), 99);
            const newUser = {
              id: maxId + 1,
              name: body.name,
              role: role,
              avatar: body.name.charAt(0).toUpperCase(),
              username: body.username,
              password: body.password,
              mustChangePassword: true
            };
            users.push(newUser);
            saveUsers(users);
            const { password, ...safeUser } = newUser;
            return sendJSON(res, { success: true, user: safeUser });
          }
          if (body.action === 'update') {
            const u = users.find(u => u.id === body.id);
            if (u) {
              u.name = body.name;
              u.avatar = body.name.charAt(0).toUpperCase();
              if (body.password) u.password = body.password;
              if (body.username) u.username = body.username;
              if (body.role) u.role = body.role === 'manager' ? 'manager' : 'sales';
              saveUsers(users);
              return sendJSON(res, { success: true });
            }
            return sendJSON(res, { error: '用户不存在' }, 404);
          }
          if (body.action === 'delete') {
            const targetUser = users.find(u => u.id === body.id);
            if (!targetUser) return sendJSON(res, { error: '用户不存在' }, 404);
            // 至少保留一个管理员
            const managerCount = users.filter(u => u.role === 'manager').length;
            if (targetUser.role === 'manager' && managerCount <= 1) {
              return sendJSON(res, { error: '至少保留一个管理员账号' }, 400);
            }
            users = users.filter(u => u.id !== body.id);
            saveUsers(users);
            // 删除用户后，其客户转给第一个管理员
            const firstManager = users.find(u => u.role === 'manager');
            if (firstManager) {
              const customers = getCustomers();
              let changed = false;
              customers.forEach(c => {
                if (c.assignedTo === body.id || c.createdBy === body.id) {
                  c.assignedTo = firstManager.id;
                  c.createdBy = firstManager.id;
                  changed = true;
                }
              });
              if (changed) saveCustomers(customers);
            }
            return sendJSON(res, { success: true });
          }
        }
        break;
      }

      default:
        return sendJSON(res, { error: '未知资源' }, 404);
    }
  } catch (e) {
    console.error('API Error:', e);
    return sendJSON(res, { error: e.message }, 500);
  }

  sendJSON(res, { error: 'Method not allowed' }, 405);
}

module.exports = handler;