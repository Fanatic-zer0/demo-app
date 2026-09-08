const { listen } = require('../../_shared/http-app');
const { createApp } = require('./app');

listen(createApp(), 'shipping-service', 8080);