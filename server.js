const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE CONFIGURATION ---
// This check tells the code if it's running on Render (production) or your PC.
const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
    // Render provides the DATABASE_URL. If it's missing, it uses your local one.
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:12345678@localhost:5432/vape_shop_db',
    // Neon/Render REQUIRE SSL. Your local computer DOES NOT.
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ Database Connection Error:', err.stack);
    console.log('✅ Database Connected Successfully');
    release();
});

// --- API ROUTES ---

// 1. LOGIN
app.post('/api/login', async (req, res) => {
    const { role, username, password, branchId } = req.body;
    try {
        if (role === 'owner') {
            if (username === 'admin' && password === 'adminpassword') {
                return res.json({ success: true });
            }
        } else {
            const result = await pool.query(
                'SELECT * FROM branches WHERE id = $1 AND "user" = $2 AND pass = $3',
                [branchId, username, password]
            );
            if (result.rows.length > 0) {
                return res.json({ success: true });
            }
        }
        res.status(401).json({ success: false, message: "Invalid Credentials" });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 2. UPDATE BRANCH CONFIG
app.post('/api/branches/update', async (req, res) => {
    const { branches } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (let b of branches) {
            await client.query(
                `INSERT INTO branches (id, name, "user", pass) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (id) 
                 DO UPDATE SET name = EXCLUDED.name, "user" = EXCLUDED.user, pass = EXCLUDED.pass`,
                [b.id, b.name, b.user, b.pass]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: e.message });
    } finally {
        client.release();
    }
});

// 3. GET PRODUCTS
app.get('/api/products/:branchId', async (req, res) => {
    const { branchId } = req.params;
    try {
        const result = await pool.query('SELECT sku, name, price, stock, branch_id FROM products WHERE branch_id = $1 ORDER BY name ASC', [branchId]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: "Failed to load products" }); }
});

// 4. CHECKOUT
app.post('/api/checkout', async (req, res) => {
    const { branchId, cart, total } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const saleInsert = await client.query("INSERT INTO sales (branch_id, total_amount) VALUES ($1, $2) RETURNING id", [parseInt(branchId), parseFloat(total)]);
        const saleId = saleInsert.rows[0].id;
        for (const item of cart) {
            await client.query("UPDATE products SET stock = stock - $1 WHERE sku = $2 AND branch_id = $3", [item.qty, item.sku, branchId]);
            await client.query("INSERT INTO sale_items (sale_id, sku, name, price, qty) VALUES ($1, $2, $3, $4, $5)", [saleId, item.sku, item.name, item.price, item.qty]);
        }
        await client.query('COMMIT');
        res.json({ success: true, saleId: saleId });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

// 5. RESTOCK
app.post('/api/restock', async (req, res) => {
    const { sku, branchId, amount } = req.body;
    try {
        const result = await pool.query("UPDATE products SET stock = stock + $1 WHERE sku = $2 AND branch_id = $3 RETURNING stock", [parseInt(amount), sku, branchId]);
        res.json({ success: true, newStock: result.rows[0].stock });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. REPORTS
app.get('/api/reports/:branchId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales WHERE branch_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.branchId]);
        res.json(result.rows);
    } catch (e) { res.status(500).json([]); }
});

// --- DYNAMIC PORT ---
// Render will assign a port. Locally it will use 3000.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
