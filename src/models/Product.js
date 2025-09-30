const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Product = sequelize.define('Product', {
    sku: {
        type: DataTypes.STRING,
        allowNull: false
    },
    network: {
        type: DataTypes.STRING,
        allowNull: false
    },
    advertiserId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    price: {
        type: DataTypes.STRING // Storing as string to preserve format (e.g. "19.99")
    },
    salePrice: {
        type: DataTypes.STRING
    },
    currency: {
        type: DataTypes.STRING,
        defaultValue: 'USD'
    },
    link: {
        type: DataTypes.TEXT
    },
    imageUrl: {
        type: DataTypes.TEXT
    },
    description: {
        type: DataTypes.TEXT
    },
    raw_data: {
        type: DataTypes.JSON, // Store full parsed object
        allowNull: true
    }
}, {
    indexes: [
        {
            fields: ['advertiserId']
        },
        {
            fields: ['network']
        }
    ]
});

module.exports = Product;
