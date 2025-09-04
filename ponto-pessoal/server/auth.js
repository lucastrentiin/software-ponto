const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;

// Registro
router.post('/register', async (req, res) => {
  const { nome, email, senha } = req.body;
  try {
    const hash = await bcrypt.hash(senha, 10);
    await pool.query('INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3)', [nome, email, hash]);
    res.status(201).json({ message: 'Usuário criado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];
    const match = await bcrypt.compare(senha, user.senha_hash);
    if (!match) return res.status(401).json({ error: 'Senha inválida' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, nome: user.nome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
