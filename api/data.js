// ============================================
// Eavision CRM - 数据API (增强安全性)
// 支持邮箱验证码修改密码 + 密码强度校验
// ============================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================
// 数据文件路径
// ============================================
const DATA_DIR = process.env.IGA_DATA_DIR || path.join(__dirname, '..', '.data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CODES_FILE = path.join(DATA_DIR, 'verification_codes.json');

// ============================================
// SMTP 配置（从环境变量读取）
// ============================================
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '587'),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'noreply@eavision.com'
};

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* optional */ }

// ============================================
// SendGrid 配置（从环境变量读取）
// ============================================
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
let sgMail = null;
if (SENDGRID_API_KEY) {
  try {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(SENDGRID_API_KEY);
  } catch (e) {
    console.log('SendGrid 模块未安装:', e.message);
  }
}

// ============================================
// 文件 I/O
// ============================================
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

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

function writeJSON(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// 密码安全
// ============================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length < 2) return stored === password; // 兼容旧版明文密码
  const salt = parts[0];
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === parts[1];
}

function validatePasswordStrength(password) {
  if (!password || password.length < 8) {
    return { valid: false, msg: '密码至少8位' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, msg: '密码必须包含字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, msg: '密码必须包含数字' };
  }
  return { valid: true };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================
// 验证码系统
// ============================================
function getVerificationCodes() {
  return readJSON(CODES_FILE, {});
}

function saveVerificationCodes(codes) {
  writeJSON(CODES_FILE, codes);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanupExpiredCodes() {
  const codes = getVerificationCodes();
  const now = Date.now();
  let changed = false;
  Object.keys(codes).forEach(key => {
    if (codes[key].expiresAt < now) {
      delete codes[key];
      changed = true;
    }
  });
  if (changed) saveVerificationCodes(codes);
}

async function sendVerificationEmail(email, code) {
  // 构建邮件 HTML 内容
  const emailHtml = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
    <h2 style="color:#2E3A59;">Eavision CRM</h2>
    <p>您正在修改密码，请使用以下验证码：</p>
    <div style="font-size:32px;font-weight:800;color:#2563eb;letter-spacing:8px;text-align:center;padding:20px;background:#f0f5ff;border-radius:8px;margin:16px 0;">${code}</div>
    <p style="color:#64748b;font-size:13px;">验证码有效期为5分钟，请勿泄露给他人。</p>
    <p style="color:#64748b;font-size:13px;">如果您没有申请修改密码，请忽略此邮件。</p>
  </div>`;

  // 方式1: SMTP 发送
  if (nodemailer && SMTP_CONFIG.host) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_CONFIG.host,
        port: SMTP_CONFIG.port,
        secure: SMTP_CONFIG.port === 465,
        auth: { user: SMTP_CONFIG.user, pass: SMTP_CONFIG.pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000
      });
      await transporter.sendMail({
        from: SMTP_CONFIG.from,
        to: email,
        subject: 'Eavision CRM - 密码修改验证码',
        html: emailHtml
      });
      console.log(`[SMTP] 验证码已发送到 ${email}`);
      return { success: true };
    } catch (e) {
      console.error('SMTP 发送失败:', e.message);
      // 继续尝试 SendGrid
    }
  }

  // 方式2: SendGrid API 发送
  if (sgMail) {
    try {
      await sgMail.send({
        to: email,
        from: { email: SMTP_CONFIG.from, name: 'Eavision CRM' },
        subject: 'Eavision CRM - 密码修改验证码',
        html: emailHtml
      });
      console.log(`[SendGrid] 验证码已发送到 ${email}`);
      return { success: true };
    } catch (e) {
      console.error('SendGrid 发送失败:', e.message);
      // 继续尝试 devMode
    }
  }

  // 方式3: 开发模式 - 在控制台显示验证码
  console.log(`[DEV MODE] 验证码 ${code} 已发送到 ${email}`);
  return { success: true, devMode: true, code: code };
}

// ============================================
// 数据 CRUD
// ============================================
function getCustomers() { return readJSON(CUSTOMERS_FILE, []); }
function getActivities() { return readJSON(ACTIVITIES_FILE, []); }
function getUsers() {
  let users = readJSON(USERS_FILE, null);
  if (!users || !Array.isArray(users) || users.length === 0) {
    users = getDefaultUsers();
    saveUsers(users);
  }
  return users;
}
function saveCustomers(data) { writeJSON(CUSTOMERS_FILE, data); }
function saveActivities(data) { writeJSON(ACTIVITIES_FILE, data); }
function saveUsers(data) { writeJSON(USERS_FILE, data); }

// 默认管理员（带邮箱字段）
function getDefaultUsers() {
  return [{
    id: 1, name: '主管理员', role: 'manager', avatar: '主',
    username: 'admin', password: 'admin123', email: 'mario.jiang@eavision.com',
    mustChangePassword: false, createdAt: new Date().toISOString()
  }];
}

// 返回用户列表时隐藏密码
function getUsersSafe() {
  return getUsers().map(u => {
    const { password, ...safe } = u;
    return safe;
  });
}

// ============================================
// 辅助函数
// ============================================
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function now() { return new Date().toISOString(); }

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
    // 调试端点：检查 SMTP 配置
    if (resource === 'debug') {
      return sendJSON(res, {
        smtp: {
          host: process.env.SMTP_HOST || '(未设置)',
          port: process.env.SMTP_PORT || '(未设置)',
          user: process.env.SMTP_USER || '(未设置)',
          pass: process.env.SMTP_PASS ? '已设置(长度:' + process.env.SMTP_PASS.length + ')' : '(未设置)',
          from: process.env.SMTP_FROM || '(未设置)',
          nodemailer: !!nodemailer ? '已加载' : '未加载'
        },
        sendgrid: {
          apiKey: SENDGRID_API_KEY ? '已设置(长度:' + SENDGRID_API_KEY.length + ')' : '(未设置)',
          module: !!sgMail ? '已加载' : '未加载'
        }
      });
    }

    switch (resource) {

      // ========== 客户 CRUD ==========
      case 'customers': {
        const customers = getCustomers();
        if (req.method === 'GET') return sendJSON(res, customers);
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (body.action === 'delete') {
            saveCustomers(customers.filter(c => c.id !== body.id));
            return sendJSON(res, { success: true });
          }
          if (body.id) {
            const idx = customers.findIndex(c => c.id === body.id);
            if (idx >= 0) {
              customers[idx] = { ...customers[idx], ...body, updatedAt: now() };
              saveCustomers(customers);
              return sendJSON(res, { success: true, customer: customers[idx] });
            }
            return sendJSON(res, { error: '客户不存在' }, 404);
          }
          const newC = { id: genId(), ...body, createdAt: now(), updatedAt: now() };
          customers.push(newC);
          saveCustomers(customers);
          return sendJSON(res, { success: true, customer: newC });
        }
        break;
      }

      // ========== 活动记录 ==========
      case 'activities': {
        let activities = getActivities();
        if (req.method === 'GET') return sendJSON(res, activities);
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
          const user = users.find(u => u.username === body.username);
          if (!user || !verifyPassword(body.password, user.password)) {
            return sendJSON(res, { error: '账号或密码错误' }, 401);
          }
          const { password, ...safeUser } = user;
          return sendJSON(res, { success: true, user: safeUser });
        }
        break;
      }

      // ========== 发送验证码（邮箱验证） ==========
      case 'send-verification-code': {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (!body.email) return sendJSON(res, { error: '请输入邮箱地址' }, 400);
          if (!validateEmail(body.email)) return sendJSON(res, { error: '邮箱格式不正确' }, 400);

          // 清理过期验证码
          cleanupExpiredCodes();

          // 如果 checkUser 为 true，验证邮箱是否与某个用户匹配
          if (body.checkUser) {
            const users = getUsers();
            if (!users.find(u => u.email === body.email)) {
              return sendJSON(res, { error: '该邮箱未绑定任何账号' }, 404);
            }
          }

          const codes = getVerificationCodes();
          const code = generateCode();
          codes[body.email] = {
            code: code,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5分钟有效
            createdAt: now()
          };
          saveVerificationCodes(codes);

          const result = await sendVerificationEmail(body.email, code);
          if (result.success) {
            return sendJSON(res, {
              success: true,
              message: result.devMode ? '开发模式，验证码见控制台' : '验证码已发送到您的邮箱',
              devMode: !!result.devMode,
              code: result.devMode ? result.code : undefined
            });
          }
          return sendJSON(res, { error: '邮件发送失败: ' + (result.error || '未知错误') }, 500);
        }
        break;
      }

      // ========== 验证码验证并修改密码 ==========
      case 'verify-and-change-password': {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (!body.email || !body.code || !body.newPassword) {
            return sendJSON(res, { error: '参数不完整' }, 400);
          }

          // 密码强度校验
          const pwdCheck = validatePasswordStrength(body.newPassword);
          if (!pwdCheck.valid) return sendJSON(res, { error: pwdCheck.msg }, 400);

          // 验证码校验
          cleanupExpiredCodes();
          const codes = getVerificationCodes();
          const stored = codes[body.email];
          if (!stored) return sendJSON(res, { error: '验证码已过期，请重新获取' }, 400);
          if (stored.code !== body.code) return sendJSON(res, { error: '验证码错误' }, 400);

          // 查找用户
          const users = getUsers();
          const user = users.find(u => u.email === body.email);
          if (!user) return sendJSON(res, { error: '该邮箱未绑定任何账号' }, 404);

          // 更新密码（哈希存储）
          user.password = hashPassword(body.newPassword);
          user.mustChangePassword = false;
          user.updatedAt = now();
          saveUsers(users);

          // 删除已使用的验证码
          delete codes[body.email];
          saveVerificationCodes(codes);

          const { password, ...safeUser } = user;
          return sendJSON(res, { success: true, user: safeUser, message: '密码修改成功' });
        }
        break;
      }

      // ========== 修改密码（旧方式，保留兼容，但需验证码） ==========
      case 'change-password': {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          if (!body.id || !body.newPassword) {
            return sendJSON(res, { error: '参数不完整' }, 400);
          }

          // 密码强度校验
          const pwdCheck = validatePasswordStrength(body.newPassword);
          if (!pwdCheck.valid) return sendJSON(res, { error: pwdCheck.msg }, 400);

          // 如果传了验证码，验证验证码
          if (body.code && body.email) {
            cleanupExpiredCodes();
            const codes = getVerificationCodes();
            const stored = codes[body.email];
            if (!stored || stored.code !== body.code) {
              return sendJSON(res, { error: '验证码错误或已过期' }, 400);
            }
            delete codes[body.email];
            saveVerificationCodes(codes);
          } else if (body.oldPassword) {
            // 用旧密码验证（兼容首次登录/个人页面修改）
            const users = getUsers();
            const u = users.find(u => u.id === body.id);
            if (!u) return sendJSON(res, { error: '用户不存在' }, 404);
            if (!verifyPassword(body.oldPassword, u.password)) {
              return sendJSON(res, { error: '原密码错误' }, 400);
            }
          } else {
            return sendJSON(res, { error: '请提供验证码或原密码' }, 400);
          }

          const users = getUsers();
          const u = users.find(u => u.id === body.id);
          if (!u) return sendJSON(res, { error: '用户不存在' }, 404);

          u.password = hashPassword(body.newPassword);
          u.mustChangePassword = false;
          u.updatedAt = now();
          saveUsers(users);

          const { password, ...safeUser } = u;
          return sendJSON(res, { success: true, user: safeUser, message: '密码修改成功' });
        }
        break;
      }

      // ========== 重置管理员密码 ==========
      case 'reset-admin': {
        if (req.method === 'POST') {
          const body = tryParseJSON(req.body);
          const users = getUsers();
          const admin = users.find(u => u.id === 1);
          if (!admin) return sendJSON(res, { error: '管理员用户不存在' }, 404);
          // 邮箱验证
          const expectedEmail = 'mario.jiang@eavision.com';
          const inputEmail = (body && body.email || '').trim().toLowerCase();
          if (inputEmail !== expectedEmail.toLowerCase()) {
            return sendJSON(res, { error: '邮箱验证失败，请输入正确的管理员邮箱' }, 403);
          }
          admin.password = 'admin123';
          admin.mustChangePassword = true;
          admin.updatedAt = now();
          saveUsers(users);
          return sendJSON(res, { success: true, message: '管理员密码已重置为 admin123' });
        }
        break;
      }

      // ========== 用户管理（增强版） ==========
      case 'users': {
        let users = getUsers();
        if (req.method === 'GET') {
          return sendJSON(res, getUsersSafe());
        }
        if (req.method === 'POST') {
          const body = await parseBody(req);

          // ---------- 添加用户 ----------
          if (body.action === 'add') {
            if (!body.name) return sendJSON(res, { error: '姓名不能为空' }, 400);
            if (!body.username) return sendJSON(res, { error: '账号不能为空' }, 400);
            if (!body.password) return sendJSON(res, { error: '密码不能为空' }, 400);
            if (!body.email) return sendJSON(res, { error: '邮箱不能为空' }, 400);
            if (!validateEmail(body.email)) return sendJSON(res, { error: '邮箱格式不正确' }, 400);

            // 密码强度校验
            const pwdCheck = validatePasswordStrength(body.password);
            if (!pwdCheck.valid) return sendJSON(res, { error: pwdCheck.msg }, 400);

            // 唯一性检查
            if (users.find(u => u.username === body.username)) {
              return sendJSON(res, { error: '账号已存在，请使用其他账号名' }, 400);
            }
            if (users.find(u => u.email === body.email)) {
              return sendJSON(res, { error: '邮箱已被其他账号使用' }, 400);
            }

            const maxId = Math.max(...users.map(u => u.id), 99);
            const newUser = {
              id: maxId + 1,
              name: body.name,
              role: body.role === 'manager' ? 'manager' : 'sales',
              avatar: body.name.charAt(0).toUpperCase(),
              username: body.username,
              email: body.email,
              password: hashPassword(body.password),
              mustChangePassword: true,
              createdAt: now(),
              updatedAt: now()
            };
            users.push(newUser);
            saveUsers(users);
            const { password, ...safeUser } = newUser;
            return sendJSON(res, { success: true, user: safeUser });
          }

          // ---------- 更新用户 ----------
          if (body.action === 'update') {
            const u = users.find(u => u.id === body.id);
            if (!u) return sendJSON(res, { error: '用户不存在' }, 404);

            if (body.name) {
              u.name = body.name;
              u.avatar = body.name.charAt(0).toUpperCase();
            }
            if (body.email) {
              if (!validateEmail(body.email)) return sendJSON(res, { error: '邮箱格式不正确' }, 400);
              if (body.email !== u.email && users.find(x => x.email === body.email)) {
                return sendJSON(res, { error: '邮箱已被其他账号使用' }, 400);
              }
              u.email = body.email;
            }
            if (body.password) {
              const pwdCheck = validatePasswordStrength(body.password);
              if (!pwdCheck.valid) return sendJSON(res, { error: pwdCheck.msg }, 400);
              u.password = hashPassword(body.password);
            }
            if (body.username) {
              if (body.username !== u.username && users.find(x => x.username === body.username)) {
                return sendJSON(res, { error: '账号名已被使用' }, 400);
              }
              u.username = body.username;
            }
            if (body.role) u.role = body.role === 'manager' ? 'manager' : 'sales';
            u.updatedAt = now();
            saveUsers(users);
            return sendJSON(res, { success: true });
          }

          // ---------- 删除用户 ----------
          if (body.action === 'delete') {
            const targetUser = users.find(u => u.id === body.id);
            if (!targetUser) return sendJSON(res, { error: '用户不存在' }, 404);
            const managerCount = users.filter(u => u.role === 'manager').length;
            if (targetUser.role === 'manager' && managerCount <= 1) {
              return sendJSON(res, { error: '至少保留一个管理员账号' }, 400);
            }
            users = users.filter(u => u.id !== body.id);
            saveUsers(users);
            // 客户转给第一个管理员
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