// ============================================
// EuroSales CRM - Railway 入口服务器
// ============================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const apiHandler = require('./api/data');

const PORT = process.env.PORT || 3000;

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// 静态文件服务
function serveStatic(req, res) {
  // 只处理 GET 请求
  if (req.method !== 'GET') return false;

  let filePath = req.url === '/' ? '/index.html' : req.url;
  // 移除查询参数
  filePath = filePath.split('?')[0];
  // 安全路径
  const fullPath = path.join(__dirname, filePath);

  // 安全检查：确保路径在项目目录内
  if (!fullPath.startsWith(__dirname)) {
    return false;
  }

  try {
    if (!fs.existsSync(fullPath)) return false;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return false;

    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(fullPath).pipe(res);
    return true;
  } catch (e) {
    return false;
  }
}

// 创建服务器
const server = http.createServer((req, res) => {
  // 尝试先匹配静态文件
  if (serveStatic(req, res)) return;

  // API 路由
  if (req.url.startsWith('/api/')) {
    apiHandler(req, res);
    return;
  }

  // 404 - 返回 index.html（SPA 支持）
  const indexPath = path.join(__dirname, 'index.html');
  try {
    const stat = fs.statSync(indexPath);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': stat.size
    });
    fs.createReadStream(indexPath).pipe(res);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`EuroSales CRM 服务器已启动，端口: ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
});