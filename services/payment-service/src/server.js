const { listen } = require('../../_shared/http-app');
const { createApp } = require('./app');

listen(createApp(), 'payment-service', 8080);