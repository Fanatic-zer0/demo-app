const { listen } = require('../../_shared/http-app');
const { createApp } = require('./app');

listen(createApp(), 'inventory-service', 8080);