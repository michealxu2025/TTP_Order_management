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

interface DebtOrderItem {
  materialName: string;
  category?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  settledAmount?: number;
  unsettledAmount: number;
}

interface ServerDebtItem {
  orderNo?: string;
  dueDate: string;
  amount: number;
  totalAmount?: number;
  settledAmount?: number;
  businessDate?: string;
  salesperson?: string;
  customerName?: string;
  customerCode?: string;
  city?: string;
  remarks?: string;
  items?: DebtOrderItem[];
}

let debtsCache: {
  data: Record<string, ServerDebtItem[]>;
  lastFetched: number;
} | null = null;

// File to store orders
const ORDERS_FILE = path.join(process.cwd(), 'orders.json');
const INVENTORY_STATE_FILE = path.join(process.cwd(), 'inventory_state.json');
const CUSTOMER_CREDENTIALS_FILE = path.join(process.cwd(), 'customer_credentials.json');
const GOOGLE_SYNC_CONFIG_FILE = path.join(process.cwd(), 'google_sync_config.json');

// Default Webhook URL for Google Sheets customer credentials synchronization
const DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzVHPKwcAeofnU0A_U5OuZvGss7S_XaGRTIxs0owDOc15weiXgOEbn7LcRI4Q-vFXHkQQ/exec';

// Helper to get and save customer credentials
async function getCustomerCredentials(): Promise<Record<string, { account: string; password: string; updatedAt?: string; sales?: string }>> {
  try {
    const raw = await fs.readFile(CUSTOMER_CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function saveCustomerCredentials(credentials: Record<string, { account: string; password: string; updatedAt?: string; sales?: string }>) {
  await fs.writeFile(CUSTOMER_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf-8');
}

async function getGoogleSyncConfig(): Promise<{ webhookUrl: string }> {
  try {
    const raw = await fs.readFile(GOOGLE_SYNC_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { webhookUrl: parsed.webhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL };
  } catch (err) {
    return { webhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL || DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL };
  }
}

async function saveGoogleSyncConfig(cfg: { webhookUrl: string }) {
  await fs.writeFile(GOOGLE_SYNC_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

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
    const credentials = await getCustomerCredentials();
    
    // Merge credentials if present
    data.forEach((c: any) => {
      const code = (c['客户代码'] || '').trim();
      const name = (c['客户名'] || '').trim();
      const cred = (code && credentials[code]) || (name && credentials[name]);
      if (cred) {
        if (cred.account) c['客户账号'] = cred.account;
        if (cred.password) c['客户密码'] = cred.password;
      }
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer data' });
  }
});

app.get('/api/google-sheets/config', async (req, res) => {
  try {
    const config = await getGoogleSyncConfig();
    const hasServiceAccount = Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.includes('@') &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL !== '12345' &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_PRIVATE_KEY.length > 50 &&
      process.env.GOOGLE_PRIVATE_KEY.includes('PRIVATE KEY')
    );
    const syncConfig = await getGoogleSyncConfig();
    const effectiveWebhookUrl = syncConfig.webhookUrl || DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL;
    res.json({
      webhookUrl: effectiveWebhookUrl,
      hasWebhook: Boolean(effectiveWebhookUrl),
      hasServiceAccount,
      serviceAccountEmail: hasServiceAccount ? process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL : null
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/google-sheets/config', async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const cleanUrl = (webhookUrl || '').trim();
    await saveGoogleSyncConfig({ webhookUrl: cleanUrl });
    res.json({ success: true, webhookUrl: cleanUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/google-sheets/test-webhook', async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const syncConfig = await getGoogleSyncConfig();
    const targetUrl = (webhookUrl || syncConfig.webhookUrl || DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL).trim();
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return res.status(400).json({ success: false, message: '未配置有效的 Webhook 地址' });
    }
    const pingRes = await axios.post(targetUrl, {
      action: 'ping',
      timestamp: new Date().toISOString()
    }, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 5
    });
    return res.json({
      success: true,
      status: pingRes.status,
      data: pingRes.data,
      message: 'Webhook 连通性测试成功！Google Apps Script 响应正常。'
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
      message: `Webhook 连接测试失败: ${err.message}`
    });
  }
});

app.post('/api/customers/update-credentials', async (req, res) => {
  try {
    const { customerCode, customerName, account, password, sales } = req.body;
    if (!customerCode && !customerName) {
      return res.status(400).json({ error: 'Missing customerCode or customerName' });
    }
    const cleanAccount = String(account || '').trim();
    const cleanPassword = String(password || '').trim();

    // 1. Save to local credentials storage (always ensures instant, zero-downtime client login)
    const credentials = await getCustomerCredentials();
    const credObj = {
      account: cleanAccount,
      password: cleanPassword,
      sales: sales || '',
      updatedAt: new Date().toISOString()
    };

    if (customerCode) credentials[String(customerCode).trim()] = credObj;
    if (customerName) credentials[String(customerName).trim()] = credObj;
    
    await saveCustomerCredentials(credentials);

    // 2. Prepare Google Sheets sync status
    let sheetSyncResult: {
      synced: boolean;
      method: 'webhook' | 'service_account' | 'none';
      message: string;
      details?: any;
    } = {
      synced: false,
      method: 'none',
      message: '已保存在系统，但尚未配置 Google 表格同步（可通过 Apps Script 脚本实现自动写入 J、K 列）'
    };

    // Check Apps Script Webhook (Priority 1: Zero configuration on Google Cloud Console)
    const syncConfig = await getGoogleSyncConfig();
    const webhookUrl = syncConfig.webhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || DEFAULT_GOOGLE_SHEETS_WEBHOOK_URL;

    if (webhookUrl && webhookUrl.startsWith('http')) {
      try {
        const webhookPayload = {
          action: 'update_customer_credentials',
          customerCode: customerCode || '',
          customerName: customerName || '',
          account: cleanAccount,
          password: cleanPassword,
          gid: '1372374637',
          timestamp: new Date().toISOString()
        };
        const hookRes = await axios.post(webhookUrl, webhookPayload, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
          maxRedirects: 5
        });
        if (hookRes.status === 200) {
          const resData = hookRes.data || {};
          if (resData.success === false) {
            sheetSyncResult = {
              synced: false,
              method: 'webhook',
              message: resData.error || 'Apps Script 处理失败',
              details: resData
            };
          } else if (resData.updated === false) {
            sheetSyncResult = {
              synced: false,
              method: 'webhook',
              message: '已请求 Webhook，但在 Google 表格中未找到对应客户代码/客户名',
              details: resData
            };
          } else {
            sheetSyncResult = {
              synced: true,
              method: 'webhook',
              message: '已通过 Google Apps Script 成功同步写入 Google 表格 J 列和 K 列！',
              details: resData
            };
          }
        } else {
          sheetSyncResult = {
            synced: false,
            method: 'webhook',
            message: `Apps Script 响应异常 (HTTP ${hookRes.status})`
          };
        }
      } catch (hookErr: any) {
        console.warn('Apps Script webhook sync warning:', hookErr.message);
        sheetSyncResult = {
          synced: false,
          method: 'webhook',
          message: `Webhook 请求失败: ${hookErr.message}`
        };
      }
    } else {
      // Priority 2: Google Service Account
      const hasRealServiceAccount = Boolean(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.includes('@') &&
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL !== '12345' &&
        process.env.GOOGLE_PRIVATE_KEY &&
        process.env.GOOGLE_PRIVATE_KEY.length > 50 &&
        process.env.GOOGLE_PRIVATE_KEY.includes('PRIVATE KEY')
      );

      if (hasRealServiceAccount) {
        try {
          const CUSTOMERS_SPREADSHEET_ID = '1sL-g0IiPox4FymR4Qt8Ru1ErqXZXuZLRxfM-_1wOE9A';
          const serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          });
          const doc = new GoogleSpreadsheet(CUSTOMERS_SPREADSHEET_ID, serviceAccountAuth);
          await doc.loadInfo();
          
          const targetGid = 1372374637;
          let sheet = doc.sheetsById[targetGid];
          if (!sheet) {
            sheet = doc.sheetsByIndex.find(s => s.sheetId === targetGid) || doc.sheetsByIndex[0];
          }

          const rows = await sheet.getRows();
          let rowUpdated = false;
          for (const row of rows) {
            const rowCode = (row.get('客户代码') || '').trim();
            const rowName = (row.get('客户名') || '').trim();
            if ((customerCode && rowCode === customerCode) || (customerName && rowName === customerName)) {
              row.set('客户账号', cleanAccount);
              row.set('客户密码', cleanPassword);
              await row.save();
              rowUpdated = true;
              break;
            }
          }
          if (rowUpdated) {
            sheetSyncResult = {
              synced: true,
              method: 'service_account',
              message: '已通过 Google Sheets API 成功同步写入 Google 表格 J 列和 K 列！'
            };
          } else {
            sheetSyncResult = {
              synced: false,
              method: 'service_account',
              message: '未在工作表中找到匹配该代码或名称的客户行'
            };
          }
        } catch (gsErr: any) {
          console.warn('Google Sheets API sync error:', gsErr.message);
          sheetSyncResult = {
            synced: false,
            method: 'service_account',
            message: `Google Sheets API 写入失败: ${gsErr.message}`
          };
        }
      } else {
        sheetSyncResult = {
          synced: false,
          method: 'none',
          message: '未配置有效 Google 服务账号凭证或 Webhook'
        };
      }
    }

    res.json({
      success: true,
      message: 'Credentials updated successfully',
      account: cleanAccount,
      password: cleanPassword,
      sheetSync: sheetSyncResult
    });
  } catch (error: any) {
    console.error('Failed to update customer credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to update credentials' });
  }
});

app.post(['/api/customer/login', '/api/customers/login'], async (req, res) => {
  try {
    const { account, password } = req.body;
    if (!account || !password) {
      return res.status(400).json({ success: false, error: 'Identifiant et mot de passe requis' });
    }

    const cleanAccount = String(account).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    const data: any[] = await fetchCSV(CUSTOMERS_URL);
    const credentials = await getCustomerCredentials();

    let matchedCustomer: any = null;

    for (const c of (data as any[])) {
      const code = (c['客户代码'] || '').trim();
      const name = (c['客户名'] || '').trim();
      const cred = (code && credentials[code]) || (name && credentials[name]);
      
      const effectiveAccount = (cred?.account || c['客户账号'] || '').trim();
      const effectivePassword = (cred?.password || c['客户密码'] || '').trim();

      if (effectiveAccount && effectivePassword) {
        if (effectiveAccount.toLowerCase() === cleanAccount && effectivePassword === cleanPassword) {
          matchedCustomer = {
            ...(c as Record<string, any>),
            '客户账号': effectiveAccount,
            '客户密码': effectivePassword
          };
          break;
        }
      }
    }

    if (!matchedCustomer) {
      return res.status(401).json({ success: false, error: 'Identifiant ou mot de passe incorrect' });
    }

    res.json({
      success: true,
      customer: matchedCustomer
    });
  } catch (error: any) {
    console.error('Customer login error:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur lors de la connexion' });
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
    let orderNoIdx = 0;    // A column (0-indexed: 0) - 出库单号
    let dateIdx = 2;       // C column (0-indexed: 2) - 业务日期
    let salesIdx = 4;      // E column (0-indexed: 4) - 销售员
    let catIdx = 5;        // F column (0-indexed: 5) - 品类
    let nameIdx = 6;       // G column (0-indexed: 6) - 物料名称
    let qtyIdx = 7;        // H column (0-indexed: 7) - 计价数量
    let priceIdx = 8;      // I column (0-indexed: 8) - 单价
    let totalIdx = 9;      // J column (0-indexed: 9) - 价税合计
    let settledIdx = 10;   // K column (0-indexed: 10) - 已结算金额
    let cityIdx = 13;      // N column (0-indexed: 13) - 城市
    let remarksIdx = 15;   // P column (0-indexed: 15) - 备注

    headers.forEach((h: string, i: number) => {
      const headerStr = String(h || '').trim();
      if (headerStr.includes('未结算')) unsettledIdx = i;
      if (headerStr.includes('到期')) dueDateIdx = i;
      if (headerStr.includes('客户编码') || headerStr.includes('客户代码')) custCodeIdx = i;
      if (headerStr === '客户' || headerStr === '客户名' || headerStr === '客户名称') custNameIdx = i;
      if (headerStr.includes('单号')) orderNoIdx = i;
      if (headerStr.includes('业务日期')) dateIdx = i;
      if (headerStr.includes('销售')) salesIdx = i;
      if (headerStr.includes('品类')) catIdx = i;
      if (headerStr.includes('物料名称')) nameIdx = i;
      if (headerStr.includes('计价数量')) qtyIdx = i;
      if (headerStr.includes('单价')) priceIdx = i;
      if (headerStr.includes('价税合计')) totalIdx = i;
      if (headerStr.includes('已结算')) settledIdx = i;
      if (headerStr.includes('城市')) cityIdx = i;
      if (headerStr.includes('备注')) remarksIdx = i;
    });

    const customerOrdersByCode: Record<string, Record<string, ServerDebtItem>> = {};
    const customerOrdersByName: Record<string, Record<string, ServerDebtItem>> = {};

    for (let i = 1; i < records.length; i++) {
      const row = records[i];
      const custCode = (row[custCodeIdx] || '').trim();
      const custName = (row[custNameIdx] || '').trim();
      if (!custCode && !custName) continue;

      const rawAmt = (row[unsettledIdx] || '').replace(/,/g, '').trim();
      const amt = parseFloat(rawAmt);
      if (!amt || isNaN(amt) || amt <= 0) continue;

      const orderNo = (row[orderNoIdx] || '').trim() || `ORD-${i}`;
      let dueDate = (row[dueDateIdx] || '').trim();
      if (!dueDate) dueDate = '未定到期日';

      const businessDate = (row[dateIdx] || '').trim();
      const salesperson = (row[salesIdx] || '').trim();
      const city = (row[cityIdx] || '').trim();
      const remarks = (row[remarksIdx] || '').trim();
      const category = (row[catIdx] || '').trim();
      const materialName = (row[nameIdx] || '').trim();
      const quantity = parseFloat((row[qtyIdx] || '0').replace(/,/g, '')) || 0;
      const unitPrice = parseFloat((row[priceIdx] || '0').replace(/,/g, '')) || 0;
      const totalPrice = parseFloat((row[totalIdx] || '0').replace(/,/g, '')) || (quantity * unitPrice);
      const settledAmount = parseFloat((row[settledIdx] || '0').replace(/,/g, '')) || 0;

      const item: DebtOrderItem = {
        materialName,
        category,
        quantity,
        unitPrice,
        totalPrice,
        settledAmount,
        unsettledAmount: amt
      };

      const addOrder = (map: Record<string, Record<string, ServerDebtItem>>, key: string) => {
        if (!map[key]) map[key] = {};
        if (!map[key][orderNo]) {
          map[key][orderNo] = {
            orderNo,
            dueDate,
            amount: 0,
            totalAmount: 0,
            settledAmount: 0,
            businessDate,
            salesperson,
            customerName: custName,
            customerCode: custCode,
            city,
            remarks,
            items: []
          };
        }
        const ord = map[key][orderNo];
        ord.amount = Math.round((ord.amount + amt) * 100) / 100;
        ord.totalAmount = Math.round(((ord.totalAmount || 0) + totalPrice) * 100) / 100;
        ord.settledAmount = Math.round(((ord.settledAmount || 0) + settledAmount) * 100) / 100;
        if (!ord.businessDate && businessDate) ord.businessDate = businessDate;
        if (!ord.salesperson && salesperson) ord.salesperson = salesperson;
        if (!ord.city && city) ord.city = city;
        if (!ord.remarks && remarks) ord.remarks = remarks;
        if (!ord.items) ord.items = [];
        ord.items.push(item);
      };

      if (custCode) addOrder(customerOrdersByCode, custCode);
      if (custName) addOrder(customerOrdersByName, custName.toLowerCase());
    }

    const buildList = (ordersMap: Record<string, ServerDebtItem>): ServerDebtItem[] => {
      const list = Object.values(ordersMap);
      list.sort((a, b) => {
        const normA = (a.dueDate || '').replace(/[/\.]/g, '-');
        const normB = (b.dueDate || '').replace(/[/\.]/g, '-');
        const cmp = normA.localeCompare(normB);
        if (cmp !== 0) return cmp;
        return (a.orderNo || '').localeCompare(b.orderNo || '');
      });
      return list;
    };

    const result: Record<string, ServerDebtItem[]> = {};
    for (const [code, ordersMap] of Object.entries(customerOrdersByCode)) {
      result[code] = buildList(ordersMap);
    }
    for (const [name, ordersMap] of Object.entries(customerOrdersByName)) {
      if (!result[name]) {
        result[name] = buildList(ordersMap);
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
