import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
await mkdir(dataDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : undefined }) : null;
const r2 = process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && process.env.R2_PUBLIC_BASE_URL ? new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }) : null;
const defaults = {
  cakes: [
    { id: 'classic-vanilla', name: 'Classic Vanilla Dream', category: 'Everyday favourites', description: 'Soft vanilla sponge layered with silky buttercream. A timeless centrepiece for birthdays, tea and every little celebration.', price: 2500, image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=85', badge: 'Bestseller', available: true },
    { id: 'chocolate-velvet', name: 'Chocolate Velvet', category: 'Chocolate lovers', description: 'Deep cocoa sponge with a smooth chocolate finish and just the right amount of indulgence.', price: 3200, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85', badge: 'Rich & lovely', available: true },
    { id: 'strawberry-cloud', name: 'Strawberry Cloud', category: 'Celebration cakes', description: 'A light, tender cake with pretty pink details, made for sweet celebrations and lovely photos.', price: 3800, image: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=900&q=85', badge: 'Customer fave', available: true },
    { id: 'cupcake-dozen', name: 'Little Celebration Cupcakes', category: 'Cupcakes & treats', description: 'A dozen soft cupcakes finished by hand. Choose your colours and add a short message.', price: 1800, image: 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=900&q=85', badge: 'Box of 12', available: true },
    { id: 'celebration-tier', name: 'The Big Day', category: 'Celebration cakes', description: 'A custom two-tier design for weddings, graduations and once-in-a-lifetime moments. Final quote confirmed on WhatsApp.', price: 9500, image: 'https://images.unsplash.com/photo-1535254973040-607b474cb50d?auto=format&fit=crop&w=900&q=85', badge: 'Made to order', available: true },
    { id: 'caramel-bliss', name: 'Salted Caramel Bliss', category: 'Everyday favourites', description: 'A buttery sponge, caramel ribbons and a whisper of salt. Comforting, generous and hard to share.', price: 3400, image: 'https://images.unsplash.com/photo-1559622214-f8a9850965bb?auto=format&fit=crop&w=900&q=85', badge: 'Small batch', available: true }
  ],
  orders: [],
  academy: [
    { id: 'academy-foundations', title: 'Cake Baking Foundations', type: 'Beginner class', description: 'Learn reliable sponge basics, ingredient prep, mixing and how to bake an even, tender cake.', price: 3500, image: 'https://images.unsplash.com/photo-1576021182211-9ea8dced3690?auto=format&fit=crop&w=1000&q=85', available: true },
    { id: 'academy-decor', title: 'Buttercream & Beautiful Finishes', type: 'Hands-on workshop', description: 'Practise smooth coats, borders, simple piping and the finishing details that make a cake feel special.', price: 5000, image: 'https://images.unsplash.com/photo-1607478900766-efe13248b125?auto=format&fit=crop&w=1000&q=85', available: true }
  ],
  media: []
};
const cakeTags = {
  'classic-vanilla': { flavours: ['Vanilla', 'Lemon'], cakeType: 'Buttercream cake', color: 'Cream' },
  'chocolate-velvet': { flavours: ['Chocolate'], cakeType: 'Buttercream cake', color: 'Chocolate' },
  'strawberry-cloud': { flavours: ['Strawberry', 'Vanilla'], cakeType: 'Celebration cake', color: 'Pink' },
  'cupcake-dozen': { flavours: ['Vanilla', 'Chocolate'], cakeType: 'Cupcakes', color: 'Mixed colours' },
  'celebration-tier': { flavours: ['Vanilla', 'Chocolate', 'Red velvet'], cakeType: 'Tiered cake', color: 'Custom colours' },
  'caramel-bliss': { flavours: ['Caramel', 'Vanilla'], cakeType: 'Buttercream cake', color: 'Caramel' }
};
function enrichCakes(cakes) { return cakes.map(c => ({ ...(cakeTags[c.id] || {}), ...c })); }
const dbPath = path.join(dataDir, 'store.json');
if (pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS sonia_cakes_store (id integer PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL)');
  await pool.query('INSERT INTO sonia_cakes_store (id, payload) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(defaults)]);
} else {
  try { await readFile(dbPath); } catch { await writeFile(dbPath, JSON.stringify(defaults, null, 2)); }
}
async function db() { if (pool) return (await pool.query('SELECT payload FROM sonia_cakes_store WHERE id = 1')).rows[0].payload; return JSON.parse(await readFile(dbPath, 'utf8')); }
async function save(data) { if (pool) return pool.query('UPDATE sonia_cakes_store SET payload = $1::jsonb WHERE id = 1', [JSON.stringify(data)]); return writeFile(dbPath, JSON.stringify(data, null, 2)); }

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(x => x.trim()) || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));

const orderSchema = z.object({
  customer: z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(24), email: z.string().email().optional().or(z.literal('')) }),
  delivery: z.object({ county: z.string().trim().min(2).max(80), address: z.string().trim().min(3).max(180), date: z.string().max(30).optional(), time: z.string().max(40).optional() }),
  items: z.array(z.object({ id: z.string().max(80), name: z.string().max(100), quantity: z.number().int().min(1).max(50), price: z.number().nonnegative(), size: z.string().max(50).optional(), flavour: z.string().max(60).optional(), message: z.string().max(140).optional() })).min(1).max(30),
  notes: z.string().max(500).optional()
});
function admin(req, res, next) {
  try { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); req.admin = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
}
const imageUpload = multer({ storage: r2 ? multer.memoryStorage() : multer.diskStorage({ destination: uploadDir, filename: (_r, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 30 * 1024 * 1024 }, fileFilter: (_r, file, cb) => cb(null, /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.mimetype)) });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || '' }));
app.get('/api/catalog', async (_req, res) => { const data = await db(); res.json({ cakes: enrichCakes(data.cakes).filter(x => x.available !== false), academy: data.academy.filter(x => x.available !== false), media: data.media }); });
app.post('/api/orders', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the order details and try again.', details: parsed.error.flatten() });
  const data = await db();
  const catalog = [...data.cakes, ...data.academy];
  const sizeFactors = { '1 kg': 1, '1.5 kg': 1.5, '2 kg': 2, '3 kg': 3 };
  const items = parsed.data.items.map(item => { const product = catalog.find(x => x.id === item.id && x.available !== false); return product ? { ...item, name: product.name || product.title, price: Math.round(Number(product.price) * (product.title ? 1 : (sizeFactors[item.size || '1 kg'] || 1))) } : null; });
  if (items.some(x => !x)) return res.status(400).json({ error: 'One of the selected items is no longer available. Refresh the menu and try again.' });
  const order = { ...parsed.data, items, id: `SC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, status: 'New', createdAt: new Date().toISOString(), total: items.reduce((sum, item) => sum + item.price * item.quantity, 0) };
  data.orders.unshift(order); await save(data);
  res.status(201).json({ order, whatsappNumber: process.env.WHATSAPP_NUMBER || '' });
});
app.post('/api/admin/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  if (!process.env.JWT_SECRET || !process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin credentials are not configured on the server.' });
  const emailOk = email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase();
  const stored = process.env.ADMIN_PASSWORD;
  const passwordOk = stored.startsWith('$2') ? await bcrypt.compare(password, stored) : crypto.timingSafeEqual(Buffer.from(password.padEnd(256).slice(0, 256)), Buffer.from(stored.padEnd(256).slice(0, 256)));
  if (!emailOk || !passwordOk) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: jwt.sign({ email: email.toLowerCase(), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' }), email });
});
app.get('/api/admin/data', admin, async (_req, res) => { const data = await db(); res.json({ ...data, cakes: enrichCakes(data.cakes) }); });
app.patch('/api/admin/orders/:id', admin, async (req, res) => { const data = await db(); const item = data.orders.find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'Order not found.' }); item.status = req.body.status; await save(data); res.json(item); });
app.post('/api/admin/cakes', admin, async (req, res) => { const data = await db(); const cake = { id: crypto.randomUUID(), ...req.body, price: Number(req.body.price), available: true }; data.cakes.unshift(cake); await save(data); res.status(201).json(cake); });
app.patch('/api/admin/cakes/:id', admin, async (req, res) => { const data = await db(); const item = data.cakes.find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'Cake not found.' }); Object.assign(item, req.body, { price: Number(req.body.price ?? item.price) }); await save(data); res.json(item); });
app.delete('/api/admin/cakes/:id', admin, async (req, res) => { const data = await db(); data.cakes = data.cakes.filter(x => x.id !== req.params.id); await save(data); res.status(204).end(); });
app.post('/api/admin/academy', admin, async (req, res) => { const data = await db(); const item = { id: crypto.randomUUID(), ...req.body, price: Number(req.body.price), available: true }; data.academy.unshift(item); await save(data); res.status(201).json(item); });
app.patch('/api/admin/academy/:id', admin, async (req, res) => { const data = await db(); const item = data.academy.find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'Class not found.' }); Object.assign(item, req.body, { price: Number(req.body.price ?? item.price) }); await save(data); res.json(item); });
app.delete('/api/admin/academy/:id', admin, async (req, res) => { const data = await db(); data.academy = data.academy.filter(x => x.id !== req.params.id); await save(data); res.status(204).end(); });
app.post('/api/admin/upload', admin, imageUpload.single('file'), async (req, res) => { if (!req.file) return res.status(400).json({ error: 'Choose an image or video file (max 30MB).' }); let key; let url; if (r2) { key = `sonia-cakes/${new Date().getFullYear()}/${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`; await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype })); url = `${(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/${key}`; } else { url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`; } const entry = { id: crypto.randomUUID(), name: req.file.originalname, type: req.file.mimetype.startsWith('video') ? 'video' : 'image', url, ...(key?{key}:{}), createdAt: new Date().toISOString() }; const data = await db(); data.media.unshift(entry); await save(data); res.status(201).json(entry); });
app.delete('/api/admin/media/:id', admin, async (req, res) => { const data = await db(); const media = data.media.find(x => x.id === req.params.id); if (media?.key && r2) await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: media.key })); data.media = data.media.filter(x => x.id !== req.params.id); await save(data); res.status(204).end(); });
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Sonia Cakes API listening on ${port}`));
