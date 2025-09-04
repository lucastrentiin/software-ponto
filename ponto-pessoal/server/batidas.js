const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token faltando' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido' });
  }
}

// Registrar batida
router.post('/', authMiddleware, async (req, res) => {
  const { horario, tipo, comprovante } = req.body;
  try {
    await pool.query(
      'INSERT INTO batidas (usuario_id, horario, tipo, comprovante_url) VALUES ($1,$2,$3,$4)',
      [req.user.id, horario, tipo, comprovante]
    );
    res.status(201).json({ message: 'Batida registrada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar batidas
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM batidas WHERE usuario_id=$1 ORDER BY horario DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
