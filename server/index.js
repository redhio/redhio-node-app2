require('isomorphic-fetch');
//require('dotenv').config();
const path = require('path');
var dotenv = require('dotenv').config({path: path.join('D:\\Apps\\redhio-node-app\\', '.env.redhio')});

const fs = require('fs');
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const logger = require('morgan');

const webpack = require('webpack');
const webpackMiddleware = require('webpack-dev-middleware');
const webpackHotMiddleware = require('webpack-hot-middleware');
const config = require('../config/webpack.config.js');

const RedhioAPIClient = require('redhio-api-node');
const RedhioExpress = require('@redhio/redhio-express');
const {MemoryStrategy} = require('@redhio/redhio-express/strategies');

const {
  REDHIO_APP_KEY,
  REDHIO_APP_HOST,
  REDHIO_APP_SECRET,
  NODE_ENV,
} = process.env;

const redhioConfig = {
  host: REDHIO_APP_HOST,
  apiKey: REDHIO_APP_KEY,
  secret: REDHIO_APP_SECRET,
  scope: ['write_orders, write_products'],
  shopStore: new MemoryStrategy(),
  afterAuth(request, response) {
    const { session: { accessToken, shop } } = request;

    registerWebhook(shop, accessToken, {
      topic: 'orders/create',
      address: `${REDHIO_APP_HOST}/order-create`,
      format: 'json'
    });

    return response.redirect('/');
  },
};

const registerWebhook = function(shopDomain, accessToken, webhook) {
  const redhio = new RedhioAPIClient({ shopName: shopDomain, accessToken: accessToken });
  redhio.webhook.create(webhook).then(
    response => console.log(`webhook '${webhook.topic}' created`),
    err => console.log(`Error creating webhook '${webhook.topic}'. ${JSON.stringify(err.response.body)}`)
  );
}

const app = express();
const isDevelopment = NODE_ENV !== 'production';

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(logger('dev'));
app.use(
  session({
    store: isDevelopment ? undefined : new RedisStore(),
    secret: REDHIO_APP_SECRET,
    resave: true,
    saveUninitialized: false,
  })
);

// Run webpack hot reloading in dev
if (isDevelopment) {
  const compiler = webpack(config);
  const middleware = webpackMiddleware(compiler, {
    hot: true,
    inline: true,
    publicPath: config.output.publicPath,
    contentBase: 'src',
    stats: {
      colors: true,
      hash: false,
      timings: true,
      chunks: false,
      chunkModules: false,
      modules: false,
    },
  });

  app.use(middleware);
  app.use(webpackHotMiddleware(compiler));
} else {
  const staticPath = path.resolve(__dirname, '../assets');
  app.use('/assets', express.static(staticPath));
}

// Install
app.get('/install', (req, res) => res.render('install'));

// Create redhio middlewares and router
const redhio = RedhioExpress(redhioConfig);

// Mount Redhio Routes
const {routes, middleware} = redhio;
const {withShop, withWebhook} = middleware;

app.use('/redhio', routes);

// Client
app.get('/', withShop({authBaseUrl: '/redhio'}), function(request, response) {
  const { session: { shop, accessToken } } = request;
  response.render('app', {
    title: 'Redhio Node App',
    apiKey: redhioConfig.apiKey,
    shop: shop,
  });
});

app.post('/order-create', withWebhook((error, request) => {
  if (error) {
    console.error(error);
    return;
  }

  console.log('We got a webhook!');
  console.log('Details: ', request.webhook);
  console.log('Body:', request.body);
}));

// Error Handlers
app.use(function(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use(function(error, request, response, next) {
  response.locals.message = error.message;
  response.locals.error = request.app.get('env') === 'development' ? error : {};

  response.status(error.status || 500);
  response.render('error');
});

module.exports = app;
