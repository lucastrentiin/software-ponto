const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { originalname, path } = req.file;
    const { data, error } = await supabase.storage.from('comprovantes').upload(originalname, require('fs').readFileSync(path));
    if (error) throw error;
    const { data: publicUrl } = supabase.storage.from('comprovantes').getPublicUrl(originalname);
    res.json({ url: publicUrl.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
