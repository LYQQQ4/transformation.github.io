const express = require('express');

module.exports = function(pool) {
  const router = express.Router();

  // 列表
  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM products ORDER BY id DESC');
      res.json({ products: rows });
    } catch (err) {
      console.error('Failed to list products', err);
      res.status(500).json({ error: 'Failed to list products' });
    }
  });

  // 详情
  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ product: rows[0] });
    } catch (err) {
      console.error('Failed to get product', err);
      res.status(500).json({ error: 'Failed to get product' });
    }
  });

  // 创建
  router.post('/', async (req, res) => {
    const { name_cn, description_en, hs_code, declaration_elements, origin, remark } = req.body;
    try {
      const [result] = await pool.query(
        `INSERT INTO products (name_cn, description_en, hs_code, declaration_elements, origin, remark)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name_cn || null, description_en || null, hs_code || null, declaration_elements || null, origin || null, remark || null]
      );

      // 生成 product_id，如果为空则以 P + id 填充
      const insertId = result.insertId;
      const productId = 'P' + String(insertId).padStart(8, '0');
      await pool.query('UPDATE products SET product_id = ? WHERE id = ?', [productId, insertId]);

      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [insertId]);
      res.status(201).json({ product: rows[0] });
    } catch (err) {
      console.error('Failed to create product', err);
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  // 更新
  router.put('/:id', async (req, res) => {
    const id = req.params.id;
    const { name_cn, description_en, hs_code, declaration_elements, origin, remark } = req.body;
    try {
      await pool.query(
        `UPDATE products SET name_cn = ?, description_en = ?, hs_code = ?, declaration_elements = ?, origin = ?, remark = ? WHERE id = ?`,
        [name_cn || null, description_en || null, hs_code || null, declaration_elements || null, origin || null, remark || null, id]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      res.json({ product: rows[0] });
    } catch (err) {
      console.error('Failed to update product', err);
      res.status(500).json({ error: 'Failed to update product' });
    }
  });

  // 删除
  router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    try {
      await pool.query('DELETE FROM products WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete product', err);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  return router;
};
