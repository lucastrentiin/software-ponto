const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Backup automático configurado com cron (ver servidor)' });
});

module.exports = router;
