const Sequelize = require('sequelize');
const path = require('path');

// Initialize SQLite database
const storagePath = path.join(__dirname, '../../database.sqlite');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: storagePath,
    logging: false // Disable logging for cleaner output
});

module.exports = sequelize;
