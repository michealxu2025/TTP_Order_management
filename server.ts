import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import crypto from 'crypto';

const app = express();
const PORT = 3000;

app.use(express.json());

// Google Sheets CSV Export URLs
const INVENTORY_URL = 'https://docs.google.com/spreadsheets/d/10DlfmwvyuEWLBDBY0N9ZcHNbzVC3ImX-jecPYMSOVsE/export?format=csv&gid=956994158';
const CUSTOMERS_URL = 'https://docs.google.com/spreadsheets/d/1sL-g0IiPox4FymR4Qt8Ru1ErqXZXuZLRxfM-_1wOE9A/export?format=csv&gid=1372374637';
const PRICES_URL = 'https://docs.google.com/spreadsheets/d/1sL-g0IiPox4FymR4Qt8Ru1ErqXZXuZLRxfM-_1wOE9A/export?format=csv&gid=432782581';
const DEBTS_URL = 'https://docs.google.com/spreadsheets/d/190CYOeWCVB68eCOszi7VwADf3N3jHwN7msmI1jmgzlg/gviz/tq?tqx=out:csv&gid=155272922';

let debtsCache: {
  data: Record<string, { dueDate: string; amount: number }[]>;
  lastFetched: number;
} | null = null;

// File to store orders
const ORDERS_FILE = path.join(process.cwd(), 'orders.json');
const INVENTORY_STATE_FILE = path.join(process.cwd(), 'inventory_state.json');

// Target Google Sheet ID
const TARGET_SHEET_ID = '1DJ9mF8iaJEl1226fjzojGwZxrg687_AuXFoloR0EPI4';

// Helper to fetch and parse CSV
async function fetchCSV(url: string) {
  try {
    const separator = url.includes('?') ? '&' : '?';
    const busterUrl = `${url}${separator}_t=${Date.now()}`;
    const response = await axios.get(busterUrl);
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    return records;
  } catch (error) {
    console.error(`Error fetching CSV from ${url}:`, error);
    throw error;
  }
}

// API Routes
app.post('/api/telegram/notify', async (req, res) => {
  try {
    const { chatIds, text } = req.body;
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      console.warn('TELEGRAM_BOT_TOKEN environment variable not set. Skipping push.');
      return res.status(200).json({ status: 'ignored', message: 'Bot Token not configured in env' });
    }

    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0 || !text) {
      return res.status(400).json({ error: 'Missing chatIds (array) or text' });
    }

    const promises = chatIds.map(async (chatId) => {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId.toString(),
          text: text,
          parse_mode: 'Markdown'
        });
        return { chatId, success: true };
      } catch (err: any) {
        console.error(`Failed to send Telegram notify to ${chatId}:`, err.response?.data || err.message);
        return { chatId, success: false, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    res.json({ status: 'completed', results });
  } catch (error: any) {
    console.error('Telegram push proxy controller error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    // 1. Fetch CSV data from Google Sheets with cache buster
    const separator = INVENTORY_URL.includes('?') ? '&' : '?';
    const busterUrl = `${INVENTORY_URL}${separator}_t=${Date.now()}`;
    const response = await axios.get(busterUrl);
    const csvContent = response.data;

    // 2. Compute MD5 hash of CSV content to check if it actually changed
    const currentHash = crypto.createHash('md5').update(csvContent).digest('hex');

    // 3. Parse CSV into records
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    // 4. Load or initialize inventory state
    let lastChangedTime = '';
    let savedHash = '';

    try {
      const stateData = await fs.readFile(INVENTORY_STATE_FILE, 'utf-8');
      const state = JSON.parse(stateData);
      lastChangedTime = state.lastChanged || '';
      savedHash = state.hash || '';
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error('Error reading inventory state file:', err);
      }
    }

    const nowStr = new Date().toISOString();

    // 5. If hash is different, update the state file with current time
    if (currentHash !== savedHash) {
      lastChangedTime = nowStr;
      await fs.writeFile(INVENTORY_STATE_FILE, JSON.stringify({
        hash: currentHash,
        lastChanged: lastChangedTime
      }, null, 2));
      console.log(`Inventory CSV changed! New hash: ${currentHash}. Last changed time: ${lastChangedTime}`);
    } else {
      // If we don't have a lastChangedTime saved yet, initialize it
      if (!lastChangedTime) {
        lastChangedTime = nowStr;
        await fs.writeFile(INVENTORY_STATE_FILE, JSON.stringify({
          hash: currentHash,
          lastChanged: lastChangedTime
        }, null, 2));
      }
    }

    res.json({
      data: records,
      lastChanged: lastChangedTime
    });
  } catch (error) {
    console.error('Failed to fetch inventory data:', error);
    res.status(500).json({ error: 'Failed to fetch inventory data' });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const data = await fetchCSV(CUSTOMERS_URL);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer data' });
  }
});

app.get('/api/prices', async (req, res) => {
  try {
    const data = await fetchCSV(PRICES_URL);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch price data' });
  }
});

app.get('/api/debts', async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 60 seconds unless forced with ?_t
    if (debtsCache && !req.query._t && (now - debtsCache.lastFetched < 60000)) {
      return res.json(debtsCache.data);
    }

    const separator = DEBTS_URL.includes('?') ? '&' : '?';
    const busterUrl = `${DEBTS_URL}${separator}_t=${Date.now()}`;
    const response = await axios.get(busterUrl);
    const records = parse(response.data, {
      skip_empty_lines: true,
      relax_column_count: true
    });

    // Determine column indexes from header
    const headers = records[0] || [];
    let unsettledIdx = 11; // L column (0-indexed: 11) - 未结算金额
    let dueDateIdx = 12;   // M column (0-indexed: 12) - 到期日
    let custCodeIdx = 14;  // O column (0-indexed: 14) - 客户编码 / 客户代码
    let custNameIdx = 3;   // D column (0-indexed: 3) - 客户

    headers.forEach((h: string, i: number) => {
      const headerStr = String(h || '').trim();
      if (headerStr.includes('未结算')) unsettledIdx = i;
      if (headerStr.includes('到期')) dueDateIdx = i;
      if (headerStr.includes('客户编码') || headerStr.includes('客户代码')) custCodeIdx = i;
      if (headerStr === '客户' || headerStr === '客户名' || headerStr === '客户名称') custNameIdx = i;
    });

    const customerDebtsByCode: Record<string, Record<string, number>> = {};
    const customerDebtsByName: Record<string, Record<string, number>> = {};

    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      const custCode = (row[custCodeIdx] || '').trim();
      const custName = (row[custNameIdx] || '').trim();
      if (!custCode && !custName) continue;

      const rawAmt = (row[unsettledIdx] || '').replace(/,/g, '').trim();
      const amt = parseFloat(rawAmt);
      if (!amt || isNaN(amt) || amt <= 0) continue;

      let dueDate = (row[dueDateIdx] || '').trim();
      if (!dueDate) dueDate = '未定到期日';

      if (custCode) {
        if (!customerDebtsByCode[custCode]) {
          customerDebtsByCode[custCode] = {};
        }
        customerDebtsByCode[custCode][dueDate] = (customerDebtsByCode[custCode][dueDate] || 0) + amt;
      }

      if (custName) {
        const normName = custName.toLowerCase();
        if (!customerDebtsByName[normName]) {
          customerDebtsByName[normName] = {};
        }
        customerDebtsByName[normName][dueDate] = (customerDebtsByName[normName][dueDate] || 0) + amt;
      }
    }

    const buildList = (dateMap: Record<string, number>) => {
      const list = Object.entries(dateMap).map(([dueDate, amount]) => ({
        dueDate,
        amount
      }));
      // Sort chronologically
      list.sort((a, b) => {
        const normA = a.dueDate.replace(/[/\.]/g, '-');
        const normB = b.dueDate.replace(/[/\.]/g, '-');
        return normA.localeCompare(normB);
      });
      return list;
    };

    const result: Record<string, { dueDate: string; amount: number }[]> = {};
    for (const [code, dateMap] of Object.entries(customerDebtsByCode)) {
      result[code] = buildList(dateMap);
    }
    for (const [name, dateMap] of Object.entries(customerDebtsByName)) {
      if (!result[name]) {
        result[name] = buildList(dateMap);
      }
    }

    debtsCache = {
      data: result,
      lastFetched: now
    };

    res.json(result);
  } catch (error) {
    console.error('Failed to fetch debt data:', error);
    if (debtsCache) {
      return res.json(debtsCache.data);
    }
    res.status(500).json({ error: 'Failed to fetch customer debt data' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const data = await fs.readFile(ORDERS_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.json([]);
    } else {
      res.status(500).json({ error: 'Failed to read orders' });
    }
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      ...req.body
    };

    // 1. Save to local JSON file as backup
    let orders = [];
    try {
      const data = await fs.readFile(ORDERS_FILE, 'utf-8');
      orders = JSON.parse(data);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    orders.push(newOrder);
    await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));

    // 2. Try to save to Google Sheets if credentials are provided
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      try {
        const serviceAccountAuth = new JWT({
          email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(TARGET_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        
        const sheet = doc.sheetsByIndex[0]; // Assuming first sheet
        
        // Prepare rows (one row per item in the order)
        const rows = newOrder.items.map((item: any) => ({
          '订单ID': newOrder.id,
          '下单时间': newOrder.createdAt,
          '客户名称': newOrder.customer['客户名'],
          '客户代码': newOrder.customer['客户代码'] || '',
          '客户级别': newOrder.customer['客户级别'],
          '物料名称': item.materialName,
          '物料代码': item.materialCode,
          '颜色': item.color,
          '数量': item.quantity,
          '单价': item.unitPrice,
          '小计': item.totalPrice,
          '预计总额': newOrder.total
        }));
        
        // Ensure header row exists (if sheet is empty)
        try {
          await sheet.setHeaderRow([
            '订单ID', '下单时间', '客户名称', '客户代码', '客户级别', 
            '物料名称', '物料代码', '颜色', '数量', '单价', '小计', '预计总额'
          ]);
        } catch (e) {
          // Header might already exist, ignore error
        }

        await sheet.addRows(rows);
        console.log('Successfully saved order to Google Sheets');
      } catch (gsError) {
        console.error('Error saving to Google Sheets:', gsError);
        // We still return 201 because local save succeeded, but we log the error
      }
    } else {
      console.warn('Google Sheets credentials not found. Order saved locally only.');
    }

    res.status(201).json(newOrder);
  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
