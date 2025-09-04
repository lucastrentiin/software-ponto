require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rotas
app.use('/api/auth', require('./auth'));
app.use('/api/batidas', require('./batidas'));
app.use('/api/files', require('./files'));
app.use('/api/backup', require('./backup'));

// Servir frontend
app.use(express.static(path.join(__dirname, '../web')));

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});
