const { listen } = require('../../_shared/http-app');
const { createApp } = require('./app');

listen(createApp(), 'order-service', 8080);