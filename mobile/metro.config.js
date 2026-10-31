const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { createWebApiProxy } = require('./scripts/web-api-proxy.cjs');
const { prepareCampusSkiaWeb } = require('./scripts/prepare-campus-skia-web.cjs');
prepareCampusSkiaWeb();
const config = getDefaultConfig(__dirname);
config.watchFolders = ['packages'].map(folder => path.resolve(__dirname, '..', folder));
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const metro = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware;
  const proxy = createWebApiProxy({ target: process.env.EXPO_WEB_API_PROXY_URL });
  return (req, res, next) => proxy(req, res, () => metro(req, res, next));
};
module.exports = config;
