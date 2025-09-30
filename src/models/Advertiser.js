const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Advertiser = sequelize.define('Advertiser', {
    id: {
        type: DataTypes.STRING, // Network-specific ID may be string (e.g. joined keywords or numeric string)
        primaryKey: true
    },
    network: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    country: {
        type: DataTypes.STRING
    },
    raw_data: {
        type: DataTypes.JSON, // Store full API response for future proofing
        allowNull: true
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['id', 'network'] // ID + Network should be unique (though network IDs shouldn't overlap usually)
        }
    ]
});

module.exports = Advertiser;
