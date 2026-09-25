import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  ShoppingCart, Package, User, 
  LogOut, CheckCircle2, AlertCircle, Eye, EyeOff, Search, 
  Plus, Trash2, ChevronRight, ChevronDown, ChevronUp, 
  FileText, X, ArrowLeft, Download, 
  RefreshCw, Star, Loader2, MessageSquare, ImageIcon, Share2, CreditCard,
  ExternalLink, Calendar, MapPin
} from 'lucide-react';
import { 
  collection, query, onSnapshot, addDoc, 
  serverTimestamp, orderBy, getDocs, doc, updateDoc 
} from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { db, auth } from '../firebase';
import html2pdf from 'html2pdf.js';
import MaterialConfigurator from './MaterialConfigurator';

interface CustomerData {
  '客户名': string;
  '客户代码': string;
  '客户级别': string;
  '所在地区': string;
  '电话号码': string;
  '销售': string;
  '信用额度'?: string;
  '客户账号'?: string;
  [key: string]: string | undefined;
}

interface PriceItem {
  '物料名称': string;
  '物料代码': string;
  '法语名'?: string;
  '法语名称'?: string;
  '法语'?: string;
  'Désignation'?: string;
  'Designation'?: string;
  'Nom du produit'?: string;
  'Description'?: string;
  'A级单价': string;
  'B级单价': string;
  'C级单价': string;
  'D级单价': string;
  '图片': string;
}

interface InventoryItem {
  '物料名称': string;
  '颜色': string;
  '可用量': string;
  ' 物料编码 ': string;
  '规格型号'?: string;
}

interface OrderItem {
  id: string;
  materialCode: string;
  inventoryCode?: string;
  specification?: string;
  materialName: string;
  color: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  frenchName?: string;
}

export interface DebtOrderItem {
  materialName: string;
  category?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  settledAmount?: number;
  unsettledAmount: number;
}

export interface DebtItem {
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

const COLOR_TRANSLATIONS: Record<string, string> = {
  '红色': 'Rouge',
  '蓝色': 'Bleu',
  '绿色': 'Vert',
  '黄色': 'Jaune',
  '黑色': 'Noir',
  '白色': 'Blanc',
  '橙色': 'Orange',
  '粉色': 'Rose',
  '紫色': 'Violet',
  '灰色': 'Gris',
  '棕色': 'Marron',
  '深蓝': 'Bleu Foncé',
  '浅蓝': 'Bleu Ciel',
  '军绿': 'Vert Militaire',
  '荧光绿': 'Vert Fluo',
  '墨绿': 'Vert Bouteille',
  '鲜艳': 'Couleurs Vives',
  '普通': 'Couleurs Standards',
  '自然': 'Naturel',
  '混色': 'Assortis'
};

const CATEGORIES = [
  { key: '盆系列', labelFr: 'Série Bassines' },
  { key: '桶系列', labelFr: 'Série Seaux' },
  { key: '水壶水杯系列', labelFr: 'Série Bidons & Gourdes' },
  { key: '椅子凳子系列', labelFr: 'Série Chaises & Meubles' },
  { key: '其他', labelFr: 'Autres articles' },
  { key: '全部', labelFr: 'Tous les produits' },
];

function getFrenchName(p: PriceItem | undefined): string {
  if (!p) return '';
  return p['物料代码'] || p['法语名'] || p['法语名称'] || p['法语'] || p['Désignation'] || p['Designation'] || p['Nom du produit'] || p['Description'] || p['物料名称'] || '';
}

const normalizeText = (s: string) => 
  (s || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, ' ').trim().toLowerCase();

const PRODUCT_ALIASES_FR: Record<string, string> = {
  '扶手椅子-菱形钢管椅--90': 'CHAISE PIED METAL 01',
  '扶手椅子/': 'CHAISE PIED METAL 01',
  '菱格钢管椅': 'CHAISE PIED METAL 01',
  '0.4升v型口杯': 'TASSE 0.4L V',
  '0.4lv型口杯': 'TASSE 0.4L V',
  '0.4升口杯': 'TASSE 0.4L',
  '0.4l口杯': 'TASSE 0.4L',
  '0.4升水杯': 'GOBLET 0.4L',
  '0.4l水杯': 'GOBLET 0.4L',
  '30l方耳盆': 'BASSINE 30L POIGNEE CARRE',
  '30l圆耳盆': 'BASSINE POIGNEE CLAIR 30L RONDE',
  '40l簿塑料盆': 'BASSINE CLAIR 40L LEGER',
  '20l油壶': 'BIDON 20L',
  '扁平果盘(大)': 'PANIER PLAT GRAND',
  '扁平果盘(中)': 'PANIER PLAT MID',
  '扁平果盘(小)': 'PANIER PLAT PETIT',
  '套盆a/': 'BOL A',
  '套盆a+b+c': 'BOL A+B+C',
  '凳子/ 47高': 'TABOURET 47CM',
  '不锈钢水塔 1000l': 'RÉSERVOIR INOX 1000L',
  '不锈钢水塔 2000l': 'RÉSERVOIR INOX 2000L',
  '过滤器 3pouce': 'FILTRE 3 POUCES',
  '滴灌带 drip tape type 200': 'BANDE GOUTTE-À-GOUTTE TYPE 200'
};

function translateCategoryFr(cat: string | undefined): string {
  if (!cat) return '-';
  const c = cat.toLowerCase();
  if (c.includes('小盆') || c.includes('盆') || c.includes('bassine') || c.includes('bol')) return 'Série Bassines';
  if (c.includes('小桶') || c.includes('大桶') || c.includes('桶') || c.includes('seau')) return 'Série Seaux';
  if (c.includes('壶') || c.includes('杯') || c.includes('satala') || c.includes('goblet') || c.includes('tasse') || c.includes('lampe') || c.includes('bidon') || c.includes('gourde')) return 'Série Bidons & Gourdes';
  if (c.includes('椅') || c.includes('凳') || c.includes('chaise') || c.includes('tabouret')) return 'Série Chaises & Meubles';
  if (c.includes('其他') || c.includes('autre')) return 'Autres articles';
  return cat;
}

export default function CustomerPortal() {
  const [customer, setCustomer] = useState<CustomerData | null>(() => {
    try {
      const saved = localStorage.getItem('ttp_client_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Client interface is exclusively in French
  const isFrench = true;
  const t = (_zh: string, fr: string) => fr;

  const translateColor = useCallback((color: string) => {
    const trimmed = (color || '').trim();
    return COLOR_TRANSLATIONS[trimmed] || trimmed;
  }, []);

  // Products and inventory data
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryUpdateTime, setInventoryUpdateTime] = useState<string>('');
  const [refreshingInventory, setRefreshingInventory] = useState(false);
  const [_loadingData, setLoadingData] = useState(true);

  // Debts and customers data (matches sales credit & debts logic)
  const [debts, setDebts] = useState<Record<string, DebtItem[]>>({});
  const [allCustomers, setAllCustomers] = useState<CustomerData[]>([]);
  const [_loadingDebts, setLoadingDebts] = useState(false);

  // Helper to find a price item by code, name, or normalized equivalent
  const findPriceItem = useCallback((item: any) => {
    const code = item?.materialCode || '';
    const name = item?.materialName || '';
    const fr = item?.frenchName || '';
    const normCode = normalizeText(code);
    const normName = normalizeText(name);
    const normFr = normalizeText(fr);

    return prices.find((p: any) => {
      const pName = normalizeText(p['物料名称']);
      const pCode = normalizeText(p['物料代码']);
      return (
        (pName && (pName === normName || pName === normCode || pName === normFr)) ||
        (pCode && (pCode === normCode || pCode === normName || pCode === normFr))
      );
    }) || prices.find((p: any) => {
      const pName = normalizeText(p['物料名称']);
      return pName && normName && (normName.includes(pName) || pName.includes(normName));
    });
  }, [prices]);

  // Translate product to French for display in orders & details
  const translateProduct = useCallback((item: any) => {
    if (item?.frenchName && !/[\u4e00-\u9fa5]/.test(item.frenchName)) {
      return item.frenchName;
    }
    const name = item?.materialName || '';
    const norm = normalizeText(name);
    if (PRODUCT_ALIASES_FR[norm]) {
      return PRODUCT_ALIASES_FR[norm];
    }
    const priceItem = findPriceItem(item);
    if (priceItem) {
      const fr = getFrenchName(priceItem);
      if (fr) return fr;
    }
    // Fallback translation if name contains Chinese characters
    if (/[\u4e00-\u9fa5]/.test(name)) {
      if (name.includes('密胺餐盘')) return `ASSIETTE MÉLAMINE ${name.replace(/密胺餐盘/, '').trim()}`;
      if (name.includes('盆')) return `BASSINE ${name.replace(/盆/, '').trim()}`.trim();
      if (name.includes('桶')) return `SEAU ${name.replace(/桶/, '').trim()}`.trim();
      if (name.includes('壶')) return `SATALAS / BIDON ${name.replace(/壶/, '').trim()}`.trim();
      if (name.includes('杯')) return `GOBLET ${name.replace(/杯/, '').trim()}`.trim();
      if (name.includes('椅')) return `CHAISE ${name.replace(/椅/, '').trim()}`.trim();
      if (name.includes('凳')) return `TABOURET ${name.replace(/凳/, '').trim()}`.trim();
    }
    return item?.frenchName || item?.materialCode || item?.materialName || '-';
  }, [findPriceItem]);

  // Login form state
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Top navigation view: 'order' (ordering wizard) or 'history' (my orders)
  const [activeTab, setActiveTab] = useState<'order' | 'history'>('order');

  // Order creation wizard steps: 1 = Produits & Quantités, 2 = Aperçu & Validation
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Draft items: materialCode -> OrderItem[]
  const [draftOrderItems, setDraftOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [expandedMaterials, setExpandedMaterials] = useState<Record<string, boolean>>({});
  const [customerRemarks, setCustomerRemarks] = useState('');
  const [generatedOrderId, setGeneratedOrderId] = useState('new order');

  // Detail view message board reply state
  const [remarksInput, setRemarksInput] = useState('');
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);

  // Debt order modal view state (点击待到期欠款中的订单号查看订单详情)
  const [viewingDebtOrder, setViewingDebtOrder] = useState<DebtItem | null>(null);

  // Category & search filter
  const [selectedCategory, setSelectedCategory] = useState<string>('盆系列');
  const [searchQuery, setSearchQuery] = useState('');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Order submission feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessOrder, setSubmitSuccessOrder] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Orders list for current customer
  const [allOrders, setAllOrders] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('cached_orders');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [_firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);

  // Track Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  // Generate Order ID: 默认为 "new order"
  const initClientOrderId = useCallback(() => {
    return 'new order';
  }, []);

  useEffect(() => {
    setGeneratedOrderId('new order');
  }, []);

  // Fetch prices, inventory, debts, and customer profiles
  const loadData = useCallback(async () => {
    try {
      setLoadingData(true);
      const [pricesRes, invRes, debtsRes, custsRes] = await Promise.all([
        fetch('/api/prices').then(r => r.json()).catch(() => []),
        fetch('/api/inventory').then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/debts').then(r => r.json()).catch(() => ({})),
        fetch('/api/customers').then(r => r.json()).catch(() => [])
      ]);
      setPrices(Array.isArray(pricesRes) ? pricesRes : []);
      const invData = invRes.data || invRes;
      setInventory(Array.isArray(invData) ? invData : []);
      if (invRes.lastChanged) {
        setInventoryUpdateTime(invRes.lastChanged);
      }
      setDebts(debtsRes && typeof debtsRes === 'object' ? debtsRes : {});
      if (Array.isArray(custsRes) && custsRes.length > 0) {
        setAllCustomers(custsRes);
      }
    } catch (e) {
      console.error('Failed to load portal data:', e);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh customer debts and profile data
  const refreshCustomerDebts = useCallback(async () => {
    try {
      setLoadingDebts(true);
      const [debtsRes, custsRes] = await Promise.all([
        fetch(`/api/debts?_t=${Date.now()}`).then(r => r.json()).catch(() => ({})),
        fetch('/api/customers').then(r => r.json()).catch(() => [])
      ]);
      setDebts(debtsRes && typeof debtsRes === 'object' ? debtsRes : {});
      if (Array.isArray(custsRes) && custsRes.length > 0) {
        setAllCustomers(custsRes);
      }
    } catch (err) {
      console.warn('Debts refresh error:', err);
    } finally {
      setLoadingDebts(false);
    }
  }, []);

  // Helper functions for parsing and calculating customer credit & debts (identical to sales logic)
  const parseDateForComparison = (dStr: string): string => {
    if (!dStr) return '';
    const parts = dStr.trim().split(/[/\-.]/);
    if (parts.length === 3) {
      let [y, m, d] = parts;
      if (y.length === 2) y = '20' + y;
      return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return dStr;
  };

  const checkIsOverdue = useCallback((dueDateStr: string): boolean => {
    if (!dueDateStr) return false;
    const normalized = parseDateForComparison(dueDateStr);
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return normalized < todayStr;
  }, []);

  const getCustomerDebts = useCallback((targetCust: Partial<CustomerData> | null | undefined): DebtItem[] => {
    if (!targetCust) return [];
    const directCode = (targetCust['客户代码'] || '').trim();
    if (directCode) {
      if (debts[directCode]) return debts[directCode];
      if (debts[directCode.toUpperCase()]) return debts[directCode.toUpperCase()];
      if (debts[directCode.toLowerCase()]) return debts[directCode.toLowerCase()];
    }
    const custName = (targetCust['客户名'] || '').trim().toLowerCase();
    if (custName) {
      if (debts[custName]) return debts[custName];
      const matched = allCustomers.find(c => (c['客户名'] || '').trim().toLowerCase() === custName);
      const code = (matched?.['客户代码'] || '').trim();
      if (code) {
        if (debts[code]) return debts[code];
        if (debts[code.toUpperCase()]) return debts[code.toUpperCase()];
      }
    }
    return [];
  }, [debts, allCustomers]);

  const getCustomerCreditStats = useCallback((targetCust: Partial<CustomerData> | null | undefined) => {
    if (!targetCust) {
      return { totalCredit: 0, totalDebt: 0, remainingCredit: 0, custDebts: [] as DebtItem[], overdueTotal: 0, overdueDebts: [] as DebtItem[] };
    }
    const custDebts = getCustomerDebts(targetCust);
    const totalDebt = custDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
    const overdueDebts = custDebts.filter(d => checkIsOverdue(d.dueDate));
    const overdueTotal = overdueDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

    let rawCredit = String(targetCust['信用额度'] || '').replace(/,/g, '').trim();
    if (!rawCredit) {
      const custCode = (targetCust['客户代码'] || '').trim().toLowerCase();
      const custName = (targetCust['客户名'] || '').trim().toLowerCase();
      const matched = allCustomers.find(c => 
        (custCode && (c['客户代码'] || '').trim().toLowerCase() === custCode) ||
        (custName && (c['客户名'] || '').trim().toLowerCase() === custName)
      );
      if (matched) {
        rawCredit = String(matched['信用额度'] || '').replace(/,/g, '').trim();
      }
    }
    const totalCredit = parseFloat(rawCredit) || 0;
    const remainingCredit = totalCredit - totalDebt;

    return {
      totalCredit,
      totalDebt,
      remainingCredit,
      custDebts,
      overdueTotal,
      overdueDebts,
    };
  }, [getCustomerDebts, checkIsOverdue, allCustomers]);

  // Real-time calculated credit & debt status for logged in customer
  const customerCreditStats = useMemo(() => {
    return getCustomerCreditStats(customer);
  }, [customer, getCustomerCreditStats]);

  // Manual refresh inventory and debts
  const refreshInventory = async () => {
    try {
      setRefreshingInventory(true);
      const [res] = await Promise.all([
        fetch('/api/inventory'),
        refreshCustomerDebts()
      ]);
      const json = await res.json();
      const invData = json.data || json;
      setInventory(Array.isArray(invData) ? invData : []);
      if (json.lastChanged) {
        setInventoryUpdateTime(json.lastChanged);
      }
    } catch (err) {
      console.error('Failed to refresh inventory:', err);
    } finally {
      setRefreshingInventory(false);
    }
  };

  const formatInventoryUpdateTime = (isoStr?: string) => {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('fr-FR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return isoStr;
    }
  };

  // Dedicated function to fetch orders directly from Firestore
  const fetchCustomerOrders = useCallback(async () => {
    try {
      setLoadingOrders(true);
      refreshCustomerDebts();
      const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach((doc) => {
        list.push({ _docId: doc.id, ...doc.data() });
      });
      if (list.length > 0) {
        setAllOrders(list);
        try {
          localStorage.setItem('cached_orders', JSON.stringify(list));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Orders direct fetch notice, falling back to cache:', err);
      try {
        const cached = localStorage.getItem('cached_orders');
        if (cached) {
          setAllOrders(JSON.parse(cached));
        }
      } catch (e) {}
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  // Listen to Firestore orders in real-time
  useEffect(() => {
    fetchCustomerOrders();

    let unsubscribe: (() => void) | null = null;
    try {
      const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => {
          list.push({ _docId: doc.id, ...doc.data() });
        });
        setAllOrders(list);
        try {
          localStorage.setItem('cached_orders', JSON.stringify(list));
        } catch (e) {}
      }, (err) => {
        console.warn('Orders real-time listener notice:', err);
      });
    } catch (e) {
      console.warn('Firestore orders sync init notice:', e);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [fetchCustomerOrders]);

  // Orders view & filter states
  const [viewingOrder, setViewingOrder] = useState<any | null>(null);
  const [orderIdFilter, setOrderIdFilter] = useState<string[]>([]);
  const [isOrderIdFilterOpen, setIsOrderIdFilterOpen] = useState(false);
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [orderSearchKeyword, setOrderSearchKeyword] = useState('');

  const translateStatus = (status: string) => {
    const mapping: Record<string, string> = {
      '新建': 'Nouveau',
      '待审核': 'En attente',
      '助销已确认': 'Confirmé (Assistance)',
      '财务已确认': 'Confirmé (Comptabilité)',
      '已通知备货': 'Préparation commande',
      '已叫车': 'Camion affrété',
      '已发货': 'Expédié / Livré',
      '已拒绝': 'Refusé',
      '已作废': 'Annulé',
      '已撤回': 'Retiré',
      '草稿': 'Brouillon',
      '待销售审核': 'En attente commercial',
      '销售退回': 'Rejeté commercial'
    };
    return mapping[status] || status;
  };

  const handleSaveRemarks = async () => {
    if (!remarksInput.trim() || !viewingOrder || !viewingOrder._docId) return;
    try {
      setIsSavingRemarks(true);
      const orderRef = doc(db, 'orders', viewingOrder._docId);
      const now = new Date();
      const timestamp = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const clientName = customer?.['客户名'] || 'Client';
      const newMessage = `[${timestamp} ${clientName}]: ${remarksInput.trim()}`;
      const updatedRemarks = viewingOrder.remarks ? `${newMessage}\n${viewingOrder.remarks}` : newMessage;
      
      await updateDoc(orderRef, {
        remarks: updatedRemarks,
        updatedAt: serverTimestamp()
      });

      setViewingOrder({
        ...viewingOrder,
        remarks: updatedRemarks
      });
      setAllOrders(prev => prev.map(o => o._docId === viewingOrder._docId ? { ...o, remarks: updatedRemarks } : o));
      setRemarksInput('');
    } catch (e) {
      console.error('Failed to update remarks:', e);
    } finally {
      setIsSavingRemarks(false);
    }
  };

  // Robust matching logic: checks customer code, customer name, account, and phone number
  const isOrderMatchingCustomer = useCallback((order: any, currentCust: CustomerData): boolean => {
    if (!order || !currentCust) return false;
    
    // Normalize target customer strings
    const targetCode = (currentCust['客户代码'] || '').trim().toLowerCase();
    const targetName = (currentCust['客户名'] || '').trim().toLowerCase();
    const targetPhone = (currentCust['电话号码'] || '').replace(/\D/g, '');
    const targetAccount = (currentCust['客户账号'] || '').trim().toLowerCase();
    
    // Clean target name by stripping (sales_name) like "Alagie(mike)" -> "alagie"
    const cleanTargetName = targetName.replace(/\(.*?\)/g, '').trim().toLowerCase();

    // Order customer information
    const oCust = order.customer || {};
    const oCode = (oCust['客户代码'] || oCust.customerCode || oCust.code || order.customerCode || '').trim().toLowerCase();
    const oName = (oCust['客户名'] || oCust.customerName || oCust.name || order.customerName || order.authorName || '').trim().toLowerCase();
    const cleanOName = oName.replace(/\(.*?\)/g, '').trim().toLowerCase();
    const oPhone = (oCust['电话号码'] || oCust.phone || '').replace(/\D/g, '');
    const oAccount = (oCust['客户账号'] || oCust.account || '').trim().toLowerCase();

    // 1. Primary Match: Customer Code (e.g. CUST0606)
    if (targetCode && oCode && targetCode === oCode) return true;

    // 2. Account Match
    if (targetAccount && oAccount && targetAccount === oAccount) return true;

    // 3. Name Match (Exact or stripped parentheses)
    if (targetName && oName) {
      if (targetName === oName) return true;
      if (cleanTargetName && cleanOName && cleanTargetName === cleanOName) return true;
      if (oName.includes(targetName) || targetName.includes(oName)) return true;
      if (cleanOName.includes(cleanTargetName) || cleanTargetName.includes(cleanOName)) return true;
    }

    // 4. Phone Match (at least 7 digits)
    if (targetPhone.length >= 7 && oPhone.length >= 7) {
      if (targetPhone === oPhone || targetPhone.endsWith(oPhone) || oPhone.endsWith(targetPhone)) return true;
    }

    return false;
  }, []);

  // Filter orders for this customer (includes sales-created and client-created orders)
  // 优化项2：取消了的订单客户看不到。不要增加过滤条件，直接看不到即可
  const customerOrders = useMemo(() => {
    if (!customer) return [];
    return allOrders.filter(o => {
      const statusLower = (o.status || '').trim();
      if (['已作废', '已取消', '已撤回', 'Annulé', 'Retiré'].includes(statusLower)) {
        return false;
      }
      return isOrderMatchingCustomer(o, customer);
    });
  }, [allOrders, customer, isOrderMatchingCustomer]);

  const displayedCustomerOrderIds = useMemo(() => {
    return Array.from(new Set(customerOrders.map(o => o.id).filter(Boolean)));
  }, [customerOrders]);

  const displayedOrders = useMemo(() => {
    return customerOrders.filter(order => {
      if (orderIdFilter.length > 0 && !orderIdFilter.includes(order.id)) {
        return false;
      }
      if (statusFilter !== '全部' && order.status !== statusFilter) {
        return false;
      }
      if (orderSearchKeyword.trim()) {
        const q = orderSearchKeyword.toLowerCase().trim();
        const matchId = (order.id || '').toLowerCase().includes(q);
        const matchRemarks = (order.remarks || '').toLowerCase().includes(q);
        const matchItems = (order.items || []).some((it: any) =>
          (it.materialName || '').toLowerCase().includes(q) ||
          (it.frenchName || '').toLowerCase().includes(q) ||
          (it.color || '').toLowerCase().includes(q)
        );
        if (!matchId && !matchRemarks && !matchItems) return false;
      }
      return true;
    });
  }, [customerOrders, orderIdFilter, statusFilter, orderSearchKeyword]);

  // Calculate today's consumption for stock subtraction
  const todayConsumption = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const consumption: Record<string, number> = {};

    allOrders.forEach(order => {
      if (order.status === '已作废' || order.status === '草稿') return;
      const orderDate = order.createdAt?.seconds ? order.createdAt.seconds * 1000 : Date.now();
      if (orderDate < startOfToday) return;

      order.items?.forEach((item: any) => {
        const code = (item.inventoryCode || item.materialCode || '').trim();
        if (code) {
          consumption[code] = (consumption[code] || 0) + (Number(item.quantity) || 0);
        }
      });
    });
    return consumption;
  }, [allOrders]);

  // Ensure Firebase Auth session for customer
  const ensureFirebaseAuth = useCallback(async (cust: CustomerData) => {
    try {
      const code = cust['客户代码'] || cust['客户名'] || 'client';
      const safeId = encodeURIComponent(code).replace(/[^a-zA-Z0-9]/g, '_');
      const email = `cust_${safeId}@customer.sheetorder.local`;
      const pass = 'CustomerPortalSecurePassword2026!';
      try {
        await signInWithEmailAndPassword(auth, email, pass);
      } catch (signInErr: any) {
        if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential') {
          await createUserWithEmailAndPassword(auth, email, pass);
        }
      }
    } catch (authErr) {
      console.warn('Firebase customer auth setup warning:', authErr);
    }
  }, []);

  // When customer is loaded or changes, guarantee auth session and fetch orders
  useEffect(() => {
    if (customer) {
      ensureFirebaseAuth(customer);
      fetchCustomerOrders();
    }
  }, [customer, ensureFirebaseAuth, fetchCustomerOrders]);

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim() || !password.trim()) {
      setLoginError('Veuillez renseigner votre identifiant et votre mot de passe.');
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLoginError(data.error || 'Identifiant ou mot de passe incorrect.');
        return;
      }

      const custData = data.customer;
      setCustomer(custData);
      localStorage.setItem('ttp_client_session', JSON.stringify(custData));
      await ensureFirebaseAuth(custData);
      fetchCustomerOrders();
    } catch (err: any) {
      setLoginError('Erreur de connexion au serveur. Veuillez vérifier votre réseau.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('ttp_client_session');
    setCustomer(null);
    setDraftOrderItems({});
    setCurrentStep(1);
    setActiveTab('order');
    setViewingOrder(null);
    setOrderIdFilter([]);
    setStatusFilter('全部');
    setOrderSearchKeyword('');
  };

  // Materials list
  const availableMaterials = useMemo(() => {
    return prices.filter(p => p['物料代码'] && p['物料名称']);
  }, [prices]);

  // Filtered materials by category & search query
  const filteredMaterials = useMemo(() => {
    return availableMaterials.filter(m => {
      const name = m['物料名称'] || '';
      const french = getFrenchName(m) || '';
      const code = m['物料代码'] || '';

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match = name.toLowerCase().includes(q) || french.toLowerCase().includes(q) || code.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Category filter
      if (selectedCategory === '全部') return true;
      const isPen = name.includes('盆');
      const isTong = name.includes('桶') || name.includes('尿壶');
      const isHuBei = (name.includes('壶') || name.includes('杯') || name.includes('阿拉丁神灯')) && !name.includes('尿壶');
      const isYiDeng = name.includes('椅') || name.includes('凳');

      if (selectedCategory === '盆系列') return isPen;
      if (selectedCategory === '桶系列') return isTong;
      if (selectedCategory === '水壶水杯系列') return isHuBei;
      if (selectedCategory === '椅子凳子系列') return isYiDeng;
      if (selectedCategory === '其他') {
        return !isPen && !isTong && !isHuBei && !isYiDeng;
      }
      return true;
    });
  }, [availableMaterials, selectedCategory, searchQuery]);

  // Handle MaterialConfigurator quantity changes
  const handleMaterialItemsChange = useCallback((materialCode: string, items: OrderItem[]) => {
    setDraftOrderItems(prev => ({
      ...prev,
      [materialCode]: items
    }));
  }, []);

  // Flattened order items
  const orderItems = useMemo<OrderItem[]>(() => {
    return (Object.values(draftOrderItems).flat() as OrderItem[]).filter(item => item && item.quantity > 0);
  }, [draftOrderItems]);

  const totalQuantity = useMemo(() => {
    return orderItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [orderItems]);

  const totalAmount = useMemo(() => {
    return orderItems.reduce((sum, item) => sum + (item.totalPrice || item.quantity * item.unitPrice), 0);
  }, [orderItems]);

  // Grouped items for Step 2 preview
  const groupedOrderItems = useMemo(() => {
    const groups: Record<string, {
      materialCode: string;
      materialName: string;
      frenchName: string;
      totalQuantity: number;
      totalPrice: number;
      unitPrice: number;
      items: OrderItem[];
    }> = {};

    orderItems.forEach(item => {
      if (!groups[item.materialCode]) {
        const priceItem = prices.find(p => String(p['物料代码']).trim() === String(item.materialCode).trim());
        const fName = priceItem ? (getFrenchName(priceItem) || item.materialName) : item.materialName;
        groups[item.materialCode] = {
          materialCode: item.materialCode,
          materialName: item.materialName,
          frenchName: fName,
          totalQuantity: 0,
          totalPrice: 0,
          unitPrice: item.unitPrice,
          items: []
        };
      }
      groups[item.materialCode].items.push(item);
      groups[item.materialCode].totalQuantity += item.quantity;
      groups[item.materialCode].totalPrice += (item.totalPrice || item.quantity * item.unitPrice);
    });

    return Object.values(groups);
  }, [orderItems, prices]);

  const toggleMaterialExpanded = (materialCode: string) => {
    setExpandedMaterials(prev => ({
      ...prev,
      [materialCode]: !prev[materialCode]
    }));
  };

  const handleRemoveItem = (id: string, materialCode: string) => {
    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        next[materialCode] = next[materialCode].filter(item => item.id !== id);
        if (next[materialCode].length === 0) {
          delete next[materialCode];
        }
      }
      return next;
    });
  };

  const handleUpdateItemQuantity = (materialCode: string, id: string, newQtyStr: string) => {
    const qty = parseInt(newQtyStr, 10);
    const validQty = isNaN(qty) ? 0 : Math.max(0, qty);

    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        next[materialCode] = next[materialCode].map(item => {
          if (item.id === id) {
            return {
              ...item,
              quantity: validQty,
              totalPrice: validQty * item.unitPrice
            };
          }
          return item;
        }).filter(item => item.quantity > 0);

        if (next[materialCode].length === 0) {
          delete next[materialCode];
        }
      }
      return next;
    });
  };

  const handleUpdateItemGroupQuantity = (materialCode: string, newTotalStr: string) => {
    const newTotal = parseInt(newTotalStr, 10);
    if (isNaN(newTotal) || newTotal < 0) return;

    setDraftOrderItems(prev => {
      const currentItems = prev[materialCode] || [];
      if (currentItems.length === 0) return prev;

      if (newTotal === 0) {
        const next = { ...prev };
        delete next[materialCode];
        return next;
      }

      const totalCurrent = currentItems.reduce((sum, item) => sum + item.quantity, 0);
      let remaining = newTotal;
      const updated = currentItems.map((item, idx) => {
        if (idx === currentItems.length - 1) {
          const q = Math.max(0, remaining);
          return { ...item, quantity: q, totalPrice: q * item.unitPrice };
        }
        const prop = totalCurrent > 0 ? (item.quantity / totalCurrent) : (1 / currentItems.length);
        const q = Math.max(0, Math.round(newTotal * prop));
        remaining -= q;
        return { ...item, quantity: q, totalPrice: q * item.unitPrice };
      });

      return {
        ...prev,
        [materialCode]: updated.filter(item => item.quantity > 0)
      };
    });
  };

  // Submit order to Firestore
  const handleSubmitOrder = async () => {
    if (!customer) return;
    if (orderItems.length === 0) {
      setErrorMsg('Veuillez au moins ajouter un produit.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await ensureFirebaseAuth(customer);
      // 优化项4：当客户新建订单时，订单号默认为new order
      const finalOrderId = 'new order';

      const orderPayload = {
        id: finalOrderId,
        status: '待销售审核', // Initial status: Pending Sales Review
        createdByCustomer: true,
        authorUid: auth.currentUser?.uid || 'customer_self',
        authorName: customer['客户名'],
        salespersonName: customer['销售'] || '',
        customer: {
          '客户名': customer['客户名'],
          '客户代码': customer['客户代码'],
          '客户级别': customer['客户级别'] || 'A',
          '所在地区': customer['所在地区'],
          '电话号码': customer['电话号码'],
          '销售': customer['销售'],
          '信用额度': customer['信用额度'] || ''
        },
        items: orderItems.map(item => ({
          id: item.id,
          materialCode: item.materialCode,
          inventoryCode: item.inventoryCode || item.materialCode,
          specification: item.specification || '',
          materialName: item.materialName,
          frenchName: item.frenchName || translateProduct(item) || item.materialName,
          color: item.color,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice
        })),
        totalAmount: totalAmount,
        remarks: customerRemarks.trim() ? `[Client]: ${customerRemarks.trim()}` : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(db, 'orders'), orderPayload);

      // Successfully saved
      setSubmitSuccessOrder({
        orderId: finalOrderId,
        totalItems: totalQuantity,
        totalAmount: totalAmount,
        sales: customer['销售']
      });

      // Clear draft
      setDraftOrderItems({});
      setCustomerRemarks('');
      setGeneratedOrderId('new order');
      setCurrentStep(1);
      fetchCustomerOrders();
    } catch (err: any) {
      console.error('Failed to submit order:', err);
      setErrorMsg('Erreur lors de la validation. Veuillez vérifier votre connexion et réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // PDF Export States (identical to Sales logic)
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfTargetOrder, setPdfTargetOrder] = useState<any | null>(null);
  const orderExportRef = useRef<HTMLDivElement>(null);
  const [mobilePdfModal, setMobilePdfModal] = useState<{
    isOpen: boolean;
    url: string;
    filename: string;
    blob: Blob | null;
  }>({
    isOpen: false,
    url: '',
    filename: '',
    blob: null
  });

  // Helper to convert a debt record into a full order structure compatible with PDF generation and viewing
  const buildOrderFromDebt = useCallback((d: DebtItem): any => {
    // 1. Lookup matching customer
    const matchedCustomer = allCustomers.find(c => 
      (d.customerCode && c['客户代码'] === d.customerCode) || 
      (d.customerName && c['客户名'] === d.customerName)
    ) || customer;

    // 2. If it already matches an order in allOrders, use that system order
    const matched = allOrders.find(o => o.id === d.orderNo || (o._docId && o._docId === d.orderNo));
    if (matched && matched.items && matched.items.length > 0) {
      return {
        ...matched,
        customer: {
          '客户名': matched.customer?.['客户名'] || d.customerName || matchedCustomer?.['客户名'] || customer?.['客户名'] || '',
          '客户代码': matched.customer?.['客户代码'] || d.customerCode || matchedCustomer?.['客户代码'] || customer?.['客户代码'] || '',
          '电话号码': matched.customer?.['电话号码'] || matchedCustomer?.['电话号码'] || customer?.['电话号码'] || '',
          '所在地区': matched.customer?.['所在地区'] || d.city || matchedCustomer?.['所在地区'] || customer?.['所在地区'] || '',
          '销售': matched.customer?.['销售'] || d.salesperson || matchedCustomer?.['销售'] || customer?.['销售'] || '',
          '信用额度': matched.customer?.['信用额度'] || matchedCustomer?.['信用额度'] || customer?.['信用额度'] || ''
        }
      };
    }

    // 3. Otherwise synthesize an Order object matching the exact schema expected by downloadFrenchPDF / orderExportRef
    const items = (d.items && d.items.length > 0) 
      ? d.items.map((it, idx) => {
          const priceData = findPriceItem(it);
          const materialCode = priceData ? priceData['物料代码'] : (it.materialName || `ITEM-${idx + 1}`);
          const frenchName = priceData ? getFrenchName(priceData) : translateProduct(it);
          return {
            id: `${materialCode}-${idx}`,
            materialCode,
            materialName: it.materialName,
            frenchName: frenchName || it.materialName,
            color: 'Standard',
            quantity: Number(it.quantity) || 0,
            unitPrice: Number(it.unitPrice) || 0,
            totalPrice: Number(it.totalPrice) || ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))
          };
        })
      : [
          {
            id: `ITEM-1`,
            materialCode: d.orderNo || 'COMMANDE',
            materialName: `Bon de livraison #${d.orderNo}`,
            frenchName: `Bon de livraison #${d.orderNo}`,
            color: 'Standard',
            quantity: 1,
            unitPrice: d.totalAmount || d.amount,
            totalPrice: d.totalAmount || d.amount
          }
        ];

    const parsedDate = d.businessDate ? new Date(d.businessDate.replace(/\//g, '-')) : new Date();
    const effectiveTotal = d.totalAmount || d.amount || items.reduce((sum, it) => sum + it.totalPrice, 0);

    return {
      _docId: d.orderNo || `DEBT-${Date.now()}`,
      id: d.orderNo || 'COMMANDE',
      status: checkIsOverdue(d.dueDate) ? 'Échu' : 'Livré',
      businessDate: d.businessDate || d.dueDate,
      createdAt: {
        toDate: () => (!isNaN(parsedDate.getTime()) ? parsedDate : new Date()),
        seconds: Math.floor((!isNaN(parsedDate.getTime()) ? parsedDate.getTime() : Date.now()) / 1000)
      },
      customer: {
        '客户名': d.customerName || matchedCustomer?.['客户名'] || customer?.['客户名'] || '',
        '客户代码': d.customerCode || matchedCustomer?.['客户代码'] || customer?.['客户代码'] || '',
        '电话号码': matchedCustomer?.['电话号码'] || customer?.['电话号码'] || '',
        '所在地区': d.city || matchedCustomer?.['所在地区'] || customer?.['所在地区'] || '',
        '销售': d.salesperson || matchedCustomer?.['销售'] || customer?.['销售'] || '',
        '信用额度': matchedCustomer?.['信用额度'] || customer?.['信用额度'] || ''
      },
      items,
      totalAmount: effectiveTotal,
      remarks: d.remarks || '',
      salespersonName: d.salesperson || matchedCustomer?.['销售'] || customer?.['销售'] || ''
    };
  }, [allOrders, prices, allCustomers, customer, findPriceItem, translateProduct]);

  // Active order for PDF export template
  const activePdfOrder = pdfTargetOrder || viewingOrder || (customerOrders.length > 0 ? customerOrders[0] : null);

  // Download French Bon de Commande PDF using sales logic (html2pdf with images, categories, and mobile sharing)
  const downloadFrenchPDF = (orderToExport: any) => {
    const targetOrder = orderToExport || viewingOrder;
    if (!targetOrder) return;

    setPdfTargetOrder(targetOrder);
    setGeneratingPdf(true);

    setTimeout(async () => {
      if (!orderExportRef.current) {
        setGeneratingPdf(false);
        setPdfTargetOrder(null);
        return;
      }
      const element = orderExportRef.current;

      // Temporarily bring element into layout flow for html2pdf container cloning and dimension calculation
      const originalDisplay = element.style.display;
      const originalPosition = element.style.position;
      const originalLeft = element.style.left;
      const originalTop = element.style.top;

      element.style.display = 'block';
      element.style.position = 'static';
      element.style.left = '0';
      element.style.top = '0';

      try {
        // Ensure layout and images have settled before cloning into html2pdf worker
        await new Promise(r => setTimeout(r, 250));

        const customerName = targetOrder.customer?.['客户名'] || customer?.['客户名'] || 'Client';
        const totalAmount = targetOrder.items?.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0) || targetOrder.totalAmount || 0;
        const filename = `${customerName}_${Math.round(totalAmount)}.pdf`;

        const opt = {
          margin:       [10, 5, 10, 5] as [number, number, number, number],
          filename:     filename,
          image:        { type: 'jpeg' as const, quality: 0.98 },
          html2canvas:  { 
            scale: 2, 
            useCORS: true,
            allowTaint: true,
            letterRendering: true,
            logging: false,
            scrollY: 0,
            scrollX: 0
          },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
          pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr', 'h1', 'h2', 'h3'] }
        };

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        const restoreElement = () => {
          element.style.display = originalDisplay;
          element.style.position = originalPosition;
          element.style.left = originalLeft;
          element.style.top = originalTop;
          setGeneratingPdf(false);
          setPdfTargetOrder(null);
        };

        if (isMobile) {
          html2pdf().set(opt).from(element).output('blob').then(async (pdfBlob: Blob) => {
            restoreElement();

            const url = URL.createObjectURL(pdfBlob);
            setMobilePdfModal({
              isOpen: true,
              url,
              filename,
              blob: pdfBlob
            });

            // Try direct native share
            const file = new File([pdfBlob], filename, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              try {
                await navigator.share({
                  files: [file],
                  title: filename,
                  text: `Bon de commande PDF - ${customerName}`
                });
              } catch (shareErr) {
                console.log('Mobile share dismissed', shareErr);
              }
            }
          }).catch((err: any) => {
            console.error('Mobile PDF Blob Generation Error:', err);
            restoreElement();
            alert('Échec de la génération du PDF');
          });
        } else {
          // Desktop - Use standard save
          html2pdf().set(opt).from(element).save().then(() => {
            restoreElement();
          }).catch((err: any) => {
            console.error('PDF Generation Error:', err);
            restoreElement();
            alert('Échec de la génération du PDF');
          });
        }
      } catch (err) {
        console.error('PDF Generation Setup Error:', err);
        element.style.display = originalDisplay;
        element.style.position = originalPosition;
        element.style.left = originalLeft;
        element.style.top = originalTop;
        setGeneratingPdf(false);
        alert('Échec de la génération du PDF');
      }
    }, 200);
  };

  // -------------------------------------------------------------
  // RENDER: LOGIN SCREEN (NO EXAMPLES IN ACCOUNT INPUT, ALL FRENCH)
  // -------------------------------------------------------------
  if (!customer) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative py-12 px-4" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center max-w-md w-full relative">
          <div className="w-14 h-14 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-blue-600 shadow-2xs">
            <ShoppingCart className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">TTP PLASTIQUE</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">
            Portail de Commande Client
          </p>
          <p className="text-gray-500 text-xs mb-6">
            Veuillez saisir votre identifiant et votre mot de passe pour accéder à votre espace commande.
          </p>

          <form onSubmit={handleLogin} className="space-y-4 text-left">
            {loginError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs flex items-start gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Identifiant
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="Votre identifiant"
                  className="theme-input w-full pl-9 pr-3 py-2 text-sm bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="theme-input w-full pr-10 py-2 text-sm bg-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors mt-2 text-sm shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loginLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Connexion en cours...</span>
                </>
              ) : (
                <>
                  <span>Accéder à l'espace commande</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-3 border-t border-gray-100 text-center">
              <p className="text-[11px] text-gray-400">
                Vous n'avez pas encore d'identifiant ? Contactez votre commercial assigné.
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: MAIN CUSTOMER ORDERING SYSTEM (PURE FRENCH INTERFACE)
  // -------------------------------------------------------------
  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 text-gray-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="app-header shrink-0">
        <div className="flex items-center gap-3">
          <div className="logo flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-gray-900">TTP PLASTIQUE</span>
          </div>
          <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-md border border-blue-200">
            Espace Client
          </span>
        </div>

        {/* View Navigation Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setActiveTab('order');
              setViewingOrder(null);
              setErrorMsg('');
              refreshCustomerDebts();
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'order'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nouvelle Commande</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('history');
              setViewingOrder(null);
              setErrorMsg('');
              fetchCustomerOrders();
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Mes Commandes</span>
            {customerOrders.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeTab === 'history' ? 'bg-white text-blue-600 font-bold' : 'bg-gray-200 text-gray-700'
              }`}>
                {customerOrders.length}
              </span>
            )}
          </button>
        </div>

        {/* Header Tools */}
        <div className="header-tools">
          {/* Customer info pill */}
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
              {customer['客户名']?.[0]?.toUpperCase() || 'C'}
            </div>
            <div className="text-left hidden sm:block">
              <div className="font-bold text-gray-800 leading-tight">{customer['客户名']}</div>
              <div className="text-[10px] text-gray-500">
                {customer['客户代码'] ? `${customer['客户代码']} • ` : ''}
                Commercial : <span className="font-semibold text-blue-600">{customer['销售'] || '-'}</span>
              </div>
            </div>
          </div>

          {/* Logout */}
          <button 
            onClick={handleLogout} 
            className="text-gray-500 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 cursor-pointer" 
            title="Se déconnecter"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="main-layout flex-1 w-full overflow-y-auto" style={{ height: 'calc(100vh - 60px)', WebkitOverflowScrolling: 'touch' }}>
        {/* VIEW 1: ORDER CREATION WIZARD */}
        {activeTab === 'order' && (
          <div className="w-full flex flex-col items-center">
            {/* Step Navigation Bar */}
            <div style={{ 
              display: 'flex', 
              gap: '20px', 
              marginBottom: '20px', 
              width: '100%', 
              maxWidth: '700px', 
              justifyContent: 'space-between' 
            }}>
              {[1, 2].map(step => (
                <div 
                  key={step} 
                  style={{ 
                    flex: 1, 
                    textAlign: 'center', 
                    padding: '10px', 
                    borderBottom: currentStep === step ? '3px solid var(--primary)' : '3px solid var(--border)',
                    color: currentStep === step ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: currentStep === step ? 'bold' : 'normal',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                  onClick={() => {
                    if (step === 2 && orderItems.length === 0) {
                      setErrorMsg('Veuillez au moins ajouter un produit avant de passer à l\'étape suivante.');
                      return;
                    }
                    setCurrentStep(step as 1 | 2);
                    setErrorMsg('');
                  }}
                >
                  {step === 1 
                    ? '① Sélection des Produits' 
                    : '② Résumé & Confirmation'}
                </div>
              ))}
            </div>

            {/* Error Message Toast */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 p-3 rounded-lg flex items-start gap-2 mb-4 max-w-xl w-full text-xs text-red-700">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Situation Financière & Crédit Client */}
            <div 
              style={{ width: '100%', maxWidth: '1000px' }}
              className={`p-4 sm:p-5 rounded-2xl border mb-5 shadow-xs transition-all ${
                customerCreditStats.overdueTotal > 0
                  ? 'bg-red-50/70 border-red-200'
                  : customerCreditStats.remainingCredit < 0
                  ? 'bg-amber-50/70 border-amber-200'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-3 border-b border-gray-200/70 gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl flex items-center justify-center shrink-0 ${
                    customerCreditStats.overdueTotal > 0
                      ? 'bg-red-100 text-red-600'
                      : customerCreditStats.remainingCredit < 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-50 text-blue-600'
                  }`}>
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 text-base">
                        Situation Financière & Impayés Client
                      </h3>
                      {customerCreditStats.overdueTotal > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white animate-pulse">
                          ⚠️ {customerCreditStats.overdueDebts.length} échéance(s) échue(s)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Suivi officiel de votre encours de crédit commercial et des échéances de règlement.
                    </p>
                  </div>
                </div>

                {/* Financial KPI Badges */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-2xs">
                    <span className="text-gray-500 block text-[11px]">Crédit Total</span>
                    <span className="font-bold font-mono text-blue-700 text-sm">
                      CFA {Math.round(customerCreditStats.totalCredit).toLocaleString('fr-FR')}
                    </span>
                  </div>

                  <div className={`px-3 py-1.5 rounded-xl border shadow-2xs ${
                    customerCreditStats.remainingCredit < 0 
                      ? 'bg-red-100 border-red-300 text-red-900' 
                      : 'bg-white border-gray-200'
                  }`}>
                    <span className="text-gray-500 block text-[11px]">Crédit Restant</span>
                    <span className={`font-bold font-mono text-sm ${
                      customerCreditStats.remainingCredit < 0 ? 'text-red-700 font-extrabold' : 'text-emerald-700'
                    }`}>
                      CFA {Math.round(customerCreditStats.remainingCredit).toLocaleString('fr-FR')}
                      {customerCreditStats.remainingCredit < 0 && (
                        <span className="ml-1 text-[10px] font-extrabold uppercase text-red-600">(Dépassement)</span>
                      )}
                    </span>
                  </div>

                  <div className="bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-2xs">
                    <span className="text-gray-500 block text-[11px]">Total Dû / Impayés</span>
                    <span className="font-bold font-mono text-red-600 text-sm">
                      CFA {Math.round(customerCreditStats.totalDebt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Overdue Warning Alert if any */}
              {customerCreditStats.overdueTotal > 0 && (
                <div className="mt-3 p-3 bg-red-100/90 border border-red-300 rounded-xl text-xs text-red-900 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>Attention : Vous avez des factures arrivées à échéance non réglées !</span>
                  </div>
                  <div className="font-bold font-mono text-sm text-red-800">
                    Total Échu : CFA {Math.round(customerCreditStats.overdueTotal).toLocaleString('fr-FR')} ({customerCreditStats.overdueDebts.length} facture(s) en retard)
                  </div>
                </div>
              )}

              {/* Debts breakdown list */}
              {customerCreditStats.custDebts.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center justify-between">
                    <span>Détail des échéances en attente ({customerCreditStats.custDebts.length}) :</span>
                    <span className="text-[11px] text-gray-500 font-normal">Classées par date d'échéance</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                    {customerCreditStats.custDebts.map((d, dIdx) => {
                      const isOd = checkIsOverdue(d.dueDate);
                      return (
                        <div 
                          key={dIdx} 
                          className={`flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg text-xs font-mono border transition-all ${
                            isOd 
                              ? 'bg-red-50/80 border-red-200 text-red-900 shadow-2xs' 
                              : 'bg-white border-gray-200 text-gray-800 shadow-2xs hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isOd ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                            {d.orderNo ? (
                              <button
                                type="button"
                                disabled={generatingPdf && pdfTargetOrder?.id === d.orderNo}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const orderObj = buildOrderFromDebt(d);
                                  downloadFrenchPDF(orderObj);
                                }}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 font-bold rounded-lg border border-blue-200 hover:border-blue-300 transition-all flex items-center gap-1.5 cursor-pointer text-xs group shadow-2xs disabled:opacity-50"
                                title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                              >
                                {generatingPdf && pdfTargetOrder?.id === d.orderNo ? (
                                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent shrink-0" />
                                ) : (
                                  <Download className="w-3.5 h-3.5 text-blue-600 group-hover:text-blue-800 shrink-0" />
                                )}
                                <span className="underline decoration-blue-300 group-hover:decoration-blue-700 font-mono">#{d.orderNo}</span>
                                <span className="text-[10px] bg-blue-200/80 text-blue-800 px-1 py-0.2 rounded font-semibold">PDF</span>
                              </button>
                            ) : null}
                            <span className="whitespace-nowrap text-xs">
                              Échéance : <strong>{d.dueDate}</strong>
                            </span>
                            {isOd && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-200 text-red-800 font-bold uppercase shrink-0">
                                ÉCHU
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between sm:justify-end gap-2 mt-1 sm:mt-0">
                            <span className={`font-bold shrink-0 whitespace-nowrap text-xs ${isOd ? 'text-red-700' : 'text-gray-900'}`}>
                              CFA {Math.round(d.amount).toLocaleString('fr-FR')}
                            </span>
                            {d.orderNo && (
                              <button
                                type="button"
                                onClick={() => setViewingDebtOrder(d)}
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                                title="Voir les détails de la commande à l'écran"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-3 py-2.5 px-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Félicitations ! Aucun impayé en cours. Votre compte est parfaitement à jour.</span>
                </div>
              )}
            </div>

            {/* STEP 1: MATERIAL SELECTION & QUANTITY CONFIGURATION */}
            {currentStep === 1 && (
              <section className="theme-section" style={{ width: '100%', maxWidth: '1000px', flexGrow: 0, overflow: 'visible' }}>
                <div className="section-header">① Sélection & Configuration des Produits</div>
                <div style={{ padding: '16px', paddingBottom: '160px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'visible' }}>
                  
                  {/* Real-time Inventory Status Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-5 shadow-2xs">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      <span className="text-xs sm:text-sm font-medium text-gray-700">
                        Mise à jour du stock :{' '}
                        <span className="font-semibold text-emerald-600 font-mono">
                          {inventoryUpdateTime ? formatInventoryUpdateTime(inventoryUpdateTime) : '-'}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={refreshInventory}
                      disabled={refreshingInventory}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-2xs transition-all border cursor-pointer ${
                        refreshingInventory
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95'
                      }`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingInventory ? 'animate-spin' : ''}`} />
                      {refreshingInventory ? 'Actualisation...' : 'Rafraîchir le stock'}
                    </button>
                  </div>

                  {/* Category Filter Pills & Search */}
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-5 bg-slate-100/80 p-3 rounded-xl">
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {CATEGORIES.map(cat => {
                        const isCatActive = selectedCategory === cat.key;
                        return (
                          <button
                            key={cat.key}
                            onClick={() => setSelectedCategory(cat.key)}
                            className={`px-3.5 py-1.5 rounded-full transition-all text-xs font-medium cursor-pointer ${
                              isCatActive ? 'bg-blue-600 text-white shadow-xs font-bold scale-105' : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-400'
                            }`}
                          >
                            {cat.labelFr}
                          </button>
                        );
                      })}
                    </div>
                    
                    {/* Search box */}
                    <div className="relative w-full sm:w-64">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        className="theme-input w-full pl-9 pr-8 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500"
                        placeholder="Rechercher par référence, désignation..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Integrated Materials Grid */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                    gap: '16px',
                    padding: '4px'
                  }}>
                    {filteredMaterials.map((m, idx) => (
                      <MaterialConfigurator
                        key={m['物料代码'] || `mat-${idx}`}
                        materialCode={m['物料代码']}
                        customerLevel={customer['客户级别'] || 'A'}
                        inventory={inventory}
                        prices={prices}
                        initialItems={draftOrderItems[m['物料代码']] || []}
                        onItemsChange={handleMaterialItemsChange}
                        onZoomImage={setZoomedImage}
                        translateColor={translateColor}
                        isFrench={isFrench}
                        todayConsumption={todayConsumption}
                        compact={true}
                        maskStock={true}
                      />
                    ))}
                  </div>

                  {/* Bottom Summary Bar & Next Button */}
                  <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-6 border-t-2 border-gray-100 mb-10 items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div>
                        <div className="text-xs text-gray-400 uppercase font-semibold">Modèles choisis</div>
                        <div className="text-xl font-bold text-blue-600">
                          {Object.keys(draftOrderItems).filter(k => (draftOrderItems[k] || []).length > 0).length}
                        </div>
                      </div>
                      <div className="border-l border-gray-200 pl-6">
                        <div className="text-xs text-gray-400 uppercase font-semibold">Quantité totale</div>
                        <div className="text-xl font-bold text-gray-800">
                          {totalQuantity} <span className="text-xs font-normal text-gray-500">pcs</span>
                        </div>
                      </div>
                      <div className="border-l border-gray-200 pl-6">
                        <div className="text-xs text-gray-400 uppercase font-semibold">Total estimé</div>
                        <div className="text-xl font-bold text-emerald-600 font-mono">
                          CFA {Math.round(totalAmount).toLocaleString('fr-FR')}
                        </div>
                      </div>
                    </div>

                    <button 
                      className="theme-btn btn-primary w-full sm:w-auto cursor-pointer"
                      style={{ padding: '12px 32px' }}
                      onClick={() => {
                        if (orderItems.length === 0) {
                          setErrorMsg('Veuillez au moins ajouter un produit.');
                          return;
                        }
                        setErrorMsg('');
                        setCurrentStep(2);
                      }}
                    >
                      Suivant : Résumé de la commande <ChevronRight className="w-4 h-4 ml-2" />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* STEP 2: ORDER SUMMARY & VALIDATION */}
            {currentStep === 2 && (
              <section className="theme-section" style={{ width: '100%', maxWidth: '750px', flexGrow: 1, overflow: 'visible' }}>
                <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>② Résumé & Confirmation de la commande</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>N° Commande :</span>
                    <button
                      type="button"
                      disabled={generatingPdf || orderItems.length === 0}
                      onClick={() => {
                        const draftOrder = {
                          _docId: generatedOrderId,
                          id: generatedOrderId,
                          status: 'Brouillon',
                          businessDate: new Date().toLocaleDateString('fr-FR'),
                          createdAt: {
                            toDate: () => new Date(),
                            seconds: Math.floor(Date.now() / 1000)
                          },
                          customer: {
                            '客户名': customer['客户名'] || '',
                            '客户代码': customer['客户代码'] || '',
                            '电话号码': customer['电话号码'] || '',
                            '所在地区': customer['所在地区'] || '',
                            '销售': customer['销售'] || '',
                            '信用额度': customer['信用额度'] || ''
                          },
                          items: orderItems.map((it, idx) => ({
                            id: `${it.materialCode}-${idx}`,
                            materialCode: it.materialCode,
                            materialName: it.materialName,
                            frenchName: it.frenchName || translateProduct(it),
                            color: it.color,
                            quantity: Number(it.quantity) || 0,
                            unitPrice: Number(it.unitPrice) || 0,
                            totalPrice: Number(it.totalPrice) || ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))
                          })),
                          totalAmount: totalAmount,
                          remarks: customerRemarks
                        };
                        downloadFrenchPDF(draftOrder);
                      }}
                      className="font-mono font-bold text-blue-600 hover:text-blue-800 text-sm px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all disabled:opacity-50"
                      title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                    >
                      {generatingPdf && pdfTargetOrder?.id === generatedOrderId ? (
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-blue-600" />
                      )}
                      <span className="underline decoration-blue-300">#{generatedOrderId}</span>
                      <span className="text-[10px] bg-blue-200/90 text-blue-800 px-1 py-0.2 rounded font-sans font-semibold">PDF</span>
                    </button>
                  </div>
                </div>
                <div style={{ padding: '16px', paddingBottom: '160px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'visible' }}>
                  {/* Customer Information Card */}
                  <div className="info-card" style={{ marginBottom: '16px', background: 'white' }}>
                    <div style={{ fontSize: '0.8rem', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                      <strong>Informations Client :</strong>
                    </div>
                    <div style={{ fontSize: '0.8rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Nom :</span> <strong className="text-gray-900">{customer['客户名']}</strong></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Code Client :</span> {customer['客户代码'] || '-'}</div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Téléphone :</span> {customer['电话号码'] || '-'}</div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Commercial assigné :</span> <span className="font-semibold text-blue-700">{customer['销售'] || '-'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Région :</span> {customer['所在地区'] || '-'}</div>
                      {customer['信用额度'] && (
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Limite de crédit :</span>{' '}
                          <strong className="text-blue-700 font-mono">
                            CFA {Number(String(customer['信用额度']).replace(/[^0-9.-]+/g, '') || 0).toLocaleString('fr-FR')}
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected Items Card */}
                  <div className="info-card" style={{ background: 'white', marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.8rem', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>Articles Sélectionnés :</strong>
                      <span className="text-xs text-gray-500 font-medium">
                        {groupedOrderItems.length} modèle(s)
                      </span>
                    </div>
                    
                    {groupedOrderItems.length === 0 ? (
                      <div className="text-center text-gray-400 py-8 text-sm">
                        Aucun produit sélectionné, veuillez revenir à l'étape précédente.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {groupedOrderItems.map((group) => (
                          <div key={group.materialCode} style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                            {/* Summary Row */}
                            <div 
                              style={{ padding: '10px', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                              onClick={() => toggleMaterialExpanded(group.materialCode)}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                  {group.frenchName || group.materialName}
                                  {group.frenchName && group.frenchName !== group.materialName && (
                                    <span className="text-xs text-gray-400 font-normal ml-2">({group.materialName})</span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>Quantité :</span>
                                    <input 
                                      type="number"
                                      className="theme-input no-spin"
                                      style={{ width: '60px', padding: '1px 4px', fontSize: '0.75rem', height: '22px', border: '1px solid var(--primary-light)', borderRadius: '4px' }}
                                      value={group.totalQuantity}
                                      onChange={(e) => handleUpdateItemGroupQuantity(group.materialCode, e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  <span style={{ opacity: 0.3 }}>|</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>P.U. :</span>
                                    <span className="font-mono font-medium text-gray-700">CFA {Number(group.unitPrice).toLocaleString('fr-FR')}</span>
                                  </div>
                                  <span style={{ opacity: 0.3 }}>|</span>
                                  <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>Sous-total : CFA {group.totalPrice.toLocaleString('fr-FR')}</span>
                                </div>
                              </div>
                              <div style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                                {expandedMaterials[group.materialCode] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                              </div>
                            </div>
                            
                            {/* Color breakdown */}
                            {expandedMaterials[group.materialCode] && (
                              <div style={{ padding: '10px', background: 'white', borderTop: '1px solid var(--border)' }}>
                                {group.items.map(item => (
                                  <div key={item.id} className="relative pr-8 py-2 border-b border-gray-100 last:border-0" style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                      <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>Couleur : {translateColor(item.color)}</span>
                                      </div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code : {item.inventoryCode || item.materialCode}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <input 
                                        type="number"
                                        min="0"
                                        className="theme-input no-spin"
                                        style={{ width: '60px', padding: '4px', fontSize: '0.8rem', textAlign: 'center' }}
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItemQuantity(item.materialCode, item.id, e.target.value)}
                                      />
                                    </div>
                                    <button 
                                      onClick={() => handleRemoveItem(item.id, item.materialCode)}
                                      className="absolute right-0 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-600 cursor-pointer"
                                      title="Supprimer cet article"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Order Remarks Card */}
                  <div className="info-card" style={{ background: 'white', marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.8rem', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                      <strong>Instructions particulières / Remarques de livraison :</strong>
                    </div>
                    <textarea 
                      className="theme-input w-full border border-gray-300 rounded-lg shadow-2xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-3 transition-all leading-relaxed" 
                      style={{ minHeight: '80px', resize: 'vertical' }} 
                      value={customerRemarks} 
                      onChange={(e) => setCustomerRemarks(e.target.value)}
                      placeholder="Saisissez vos instructions pour cette commande (lieu de déchargement, contact sur place, date souhaitée, etc.)..."
                    />
                  </div>

                  {/* Financial & Quantities Summary Card */}
                  <div className="info-card" style={{ background: '#f8fafc', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-sm font-medium text-gray-600">Nombre total de pièces :</span>
                      <span className="text-base font-bold text-gray-900">{totalQuantity} pcs</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t border-gray-200 mt-2">
                      <span className="text-base font-bold text-gray-900">Montant Total Général :</span>
                      <span className="text-2xl font-black text-blue-600 font-mono">CFA {Math.round(totalAmount).toLocaleString('fr-FR')}</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
                    <button 
                      className="theme-btn btn-secondary cursor-pointer" 
                      style={{ background: '#f1f5f9', color: 'var(--text-main)', padding: '10px 24px' }} 
                      onClick={() => setCurrentStep(1)}
                    >
                      Précédent : Modifier les articles
                    </button>
                    <button 
                      className="theme-btn btn-primary cursor-pointer"
                      style={{ padding: '12px 36px', fontSize: '1rem', fontWeight: 'bold' }}
                      disabled={isSubmitting || orderItems.length === 0}
                      onClick={handleSubmitOrder}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Validation en cours...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5" />
                          Valider et envoyer la commande
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* VIEW 2: ORDER HISTORY ("MES COMMANDES") */}
        {activeTab === 'history' && (
          <div className="w-full flex flex-col items-center pb-24">
            {viewingOrder ? (
              /* ORDER DETAIL VIEW */
              <div className="w-full max-w-5xl">
                {/* Back & Order ID Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setViewingOrder(null)}
                      className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
                      title="Retour à la liste"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      disabled={generatingPdf && pdfTargetOrder?._docId === viewingOrder._docId}
                      onClick={() => downloadFrenchPDF(viewingOrder)}
                      className="text-xl font-bold text-blue-600 hover:text-blue-800 hover:underline font-mono cursor-pointer flex items-center gap-1.5 disabled:opacity-50 text-left"
                      title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                    >
                      <span>#{viewingOrder.id}</span>
                      {generatingPdf && pdfTargetOrder?._docId === viewingOrder._docId ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                      ) : (
                        <Download className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase border ${
                      viewingOrder.status === '待销售审核'
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : viewingOrder.status === '销售退回'
                        ? 'bg-red-100 text-red-900 border-red-300'
                        : viewingOrder.status === '已发货'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : viewingOrder.status === '草稿'
                        ? 'bg-gray-100 text-gray-700 border border-gray-200'
                        : 'bg-blue-100 text-blue-800 border border-blue-200'
                    }`}>
                      {translateStatus(viewingOrder.status)}
                    </span>
                    {viewingOrder.isPriority && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900 flex items-center gap-1">
                        <Star className="w-3 h-3 fill-yellow-900" /> URGENT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-0 sm:ml-auto">
                    <button
                      onClick={() => downloadFrenchPDF(viewingOrder)}
                      disabled={generatingPdf}
                      className={`px-4 py-2 ${generatingPdf && pdfTargetOrder?._docId === viewingOrder._docId ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed`}
                    >
                      {generatingPdf && pdfTargetOrder?._docId === viewingOrder._docId ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      <span>{generatingPdf && pdfTargetOrder?._docId === viewingOrder._docId ? 'Génération...' : 'Télécharger Bon de Commande (PDF)'}</span>
                    </button>
                  </div>
                </div>

                {/* If Sales Returned, show prominent notice & button to re-edit */}
                {viewingOrder.status === '销售退回' && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 shadow-sm">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-bold text-sm text-red-900">
                          Cette commande a été rejetée par le commercial
                        </h4>
                        <p className="text-xs text-red-700 mt-1 whitespace-pre-wrap">
                          {viewingOrder.remarks || 'Aucune raison spécifiée. Veuillez contacter votre commercial pour plus d\'informations.'}
                        </p>
                        <button
                          onClick={() => {
                            const reDraft: Record<string, OrderItem[]> = {};
                            (viewingOrder.items || []).forEach((it: any) => {
                              const mCode = it.materialCode;
                              if (!reDraft[mCode]) reDraft[mCode] = [];
                              reDraft[mCode].push({
                                id: it.id || `${mCode}-${it.color}`,
                                materialCode: mCode,
                                inventoryCode: it.inventoryCode || mCode,
                                specification: it.specification || '',
                                materialName: it.materialName,
                                frenchName: it.frenchName || it.materialName,
                                color: it.color,
                                quantity: it.quantity,
                                unitPrice: it.unitPrice,
                                totalPrice: it.totalPrice || (it.quantity * it.unitPrice)
                              });
                            });
                            setDraftOrderItems(reDraft);
                            setViewingOrder(null);
                            setActiveTab('order');
                            setCurrentStep(1);
                          }}
                          className="mt-3 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Reprendre et modifier cette commande</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Customer & Order Metadata Card - Identical to sales view, with customer level hidden */}
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-6 print:shadow-none print:border-gray-300">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-800">
                      Informations Client
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block mb-1">Nom du client</span>
                      <span className="font-medium text-gray-900">{viewingOrder.customer?.['客户名'] || customer?.['客户名']}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Code client</span>
                      <span className="font-medium font-mono">{viewingOrder.customer?.['客户代码'] || customer?.['客户代码'] || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Téléphone</span>
                      <span className="font-medium">{viewingOrder.customer?.['电话号码'] || customer?.['电话号码'] || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Commercial assigné</span>
                      <span className="font-medium">{viewingOrder.customer?.['销售'] || viewingOrder.salespersonName || customer?.['销售'] || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Région</span>
                      <span className="font-medium">{viewingOrder.customer?.['所在地区'] || customer?.['所在地区'] || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Date de commande</span>
                      <span className="font-medium">
                        {viewingOrder.createdAt?.seconds 
                          ? new Date(viewingOrder.createdAt.seconds * 1000).toLocaleString('fr-FR', {
                              year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                            })
                          : (viewingOrder.createdAt?.toDate ? viewingOrder.createdAt.toDate().toLocaleString('fr-FR') : '-')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Plafond de crédit</span>
                      <span className="font-medium font-mono text-blue-700">
                        CFA {Math.round(getCustomerCreditStats(viewingOrder.customer || customer).totalCredit).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block mb-1">Crédit Restant</span>
                      <span className={`font-medium font-mono ${getCustomerCreditStats(viewingOrder.customer || customer).remainingCredit < 0 ? 'text-red-600 font-bold' : 'text-green-700'}`}>
                        CFA {Math.round(getCustomerCreditStats(viewingOrder.customer || customer).remainingCredit).toLocaleString('fr-FR')}
                        {getCustomerCreditStats(viewingOrder.customer || customer).remainingCredit < 0 ? ' (Dépassement de plafond)' : ''}
                      </span>
                    </div>
                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-3">
                      <span className="text-gray-500 block mb-1">Notes & Remarques client</span>
                      <div className="font-medium text-gray-900 break-words block">
                        {viewingOrder.customer?.['备注'] || '-'}
                      </div>
                    </div>
                  </div>

                  {/* Situation crédit & impayés client */}
                  {(() => {
                    const stats = getCustomerCreditStats(viewingOrder.customer || customer);
                    const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
                    if (custDebts.length === 0 && totalCredit === 0) return null;

                    return (
                      <div className="mt-4 p-3.5 bg-red-50/80 border border-red-200 rounded-lg text-xs">
                        <div className="flex flex-wrap items-center justify-between font-bold text-red-800 mb-2 gap-2">
                          <span className="flex items-center gap-1.5 text-sm">
                            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <span>Situation crédit & impayés client</span>
                          </span>
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-200">
                              Crédit Total : <span className="text-blue-700">CFA {Math.round(totalCredit).toLocaleString('fr-FR')}</span>
                            </span>
                            <span className={`font-bold px-2 py-0.5 rounded border ${remainingCredit < 0 ? 'bg-red-100 border-red-300 text-red-800' : 'bg-white border-green-200 text-green-800'}`}>
                              Crédit Restant : <span>CFA {Math.round(remainingCredit).toLocaleString('fr-FR')}</span>
                            </span>
                            <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-red-100">
                              Total Dû : <span className="text-red-700">CFA {Math.round(totalDebt).toLocaleString('fr-FR')}</span>
                            </span>
                          </div>
                        </div>
                        {overdueTotal > 0 && (
                          <div className="text-red-700 font-semibold mb-2 bg-red-100/80 p-2 rounded border border-red-200 flex items-center justify-between">
                            <span>⚠️ Dont impayés échus :</span>
                            <span className="font-bold text-red-800 text-sm">CFA {Math.round(overdueTotal).toLocaleString('fr-FR')} ({overdueDebts.length} échéance(s) en retard)</span>
                          </div>
                        )}
                        {custDebts.length > 0 && (
                          <div className="space-y-1 max-h-36 overflow-y-auto bg-white p-2 rounded border border-red-100 font-mono text-xs">
                            {custDebts.map((d, dIdx) => {
                              const isOd = checkIsOverdue(d.dueDate);
                              return (
                                <div key={dIdx} className={`flex justify-between items-center py-1 px-1.5 rounded ${isOd ? 'bg-red-50/70 text-red-700 font-bold' : 'text-gray-700 border-b border-gray-50 last:border-0'}`}>
                                  <div className="flex items-center gap-1.5">
                                    {d.orderNo && (
                                      <button
                                        type="button"
                                        disabled={generatingPdf && pdfTargetOrder?.id === d.orderNo}
                                        onClick={() => {
                                          const orderObj = buildOrderFromDebt(d);
                                          downloadFrenchPDF(orderObj);
                                        }}
                                        className="text-blue-600 hover:text-blue-800 hover:underline font-bold cursor-pointer inline-flex items-center gap-1 text-xs"
                                        title="Télécharger Bon de Commande (PDF)"
                                      >
                                        {generatingPdf && pdfTargetOrder?.id === d.orderNo ? (
                                          <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent" />
                                        ) : (
                                          <Download className="w-3 h-3 text-blue-500" />
                                        )}
                                        <span>#{d.orderNo} (PDF)</span>
                                      </button>
                                    )}
                                    <span>{d.dueDate} {isOd ? '(ÉCHU)' : ''}</span>
                                  </div>
                                  <span>CFA {Math.round(d.amount).toLocaleString('fr-FR')}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Espace d'échange / Remarques */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 print:shadow-none print:border-gray-300 overflow-hidden flex flex-col">
                  <div className="flex justify-between items-center p-4 border-b bg-gray-50 flex-shrink-0">
                    <h3 className="font-bold text-gray-800">
                      Espace d'échange & Remarques
                    </h3>
                  </div>
                  
                  <div className="p-4 text-sm text-gray-700 whitespace-pre-wrap flex-grow space-y-2" style={{minHeight: '100px'}}>
                    {!viewingOrder.remarks ? (
                      <span className="text-gray-400 italic">Aucun message pour le moment</span>
                    ) : (
                      (() => {
                        const allLines = (viewingOrder.remarks || '').split('\n');
                        const filteredLines = allLines.filter((l: string) => l.trim().length > 0);
                        if (filteredLines.length === 0) {
                          return <span className="text-gray-400 italic">Aucun message pour le moment</span>;
                        }
                        return filteredLines.map((line: string, i: number) => {
                          const sysLogMatch = line.match(/^\[(系统日志|Log Système)\s([0-9/: \-]+)\s([^\]]+)\]:(.*)/);
                          if (sysLogMatch) {
                            const timestamp = sysLogMatch[2];
                            const operator = sysLogMatch[3];
                            const actionBody = sysLogMatch[4];
                            return (
                              <div key={i} className="min-h-[1em] mb-1 p-1.5 rounded-lg bg-gray-50/60 border-l-2 border-gray-300">
                                <span className="text-gray-900 font-normal text-sm">
                                  <span className="text-gray-650 bg-gray-100 border border-gray-300 font-medium text-[13px] mr-2 px-1.5 py-0.5 rounded inline-block">
                                    [Log Système {timestamp} {operator}]
                                  </span>
                                  {actionBody}
                                </span>
                              </div>
                            );
                          }

                          const prefixMatch = line.match(/^\[(.*?20\d{2}\/\d{2}\/\d{2} \d{2}:\d{2} .*?)\]:/) || line.match(/^\[(.*?)\]:/);
                          if (prefixMatch) {
                            return (
                              <div key={i} className="min-h-[1em] mb-1 p-1.5 rounded-lg bg-blue-50/30 border-l-2 border-blue-400">
                                <span className="text-blue-600 bg-blue-50 text-[13px] mr-2 px-1 rounded font-medium">
                                  [{prefixMatch[1]}]
                                </span>
                                <span className="text-gray-800">
                                  {line.substring(prefixMatch[0].length)}
                                </span>
                              </div>
                            );
                          }

                          return (
                            <div key={i} className="min-h-[1em] mb-1 p-1.5 rounded-lg text-gray-800">
                              {line}
                            </div>
                          );
                        });
                      })()
                    )}
                  </div>

                  <div className="p-4 border-t bg-gray-50 flex-shrink-0 flex flex-col gap-2">
                    <textarea
                      className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[60px] resize-y bg-white"
                      value={remarksInput}
                      onChange={(e) => setRemarksInput(e.target.value)}
                      placeholder="Tapez votre message ici..."
                    />
                    <div className="flex justify-end mt-1">
                      <button
                        onClick={handleSaveRemarks}
                        disabled={!remarksInput.trim() || isSavingRemarks}
                        className="px-4 py-2 text-sm bg-blue-600 disabled:bg-blue-300 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        {isSavingRemarks ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        <span>{isSavingRemarks ? 'Envoi...' : 'Envoyer'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Détails de la Commande */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-gray-300 mb-6">
                  <div className="p-6 border-b border-gray-200 print:p-4">
                    <h3 className="font-bold text-gray-800">
                      Détails de la Commande
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 font-medium">Produit / Désignation</th>
                          <th className="px-6 py-3 font-medium">Couleur</th>
                          <th className="px-6 py-3 font-medium">Code Produit</th>
                          <th className="px-6 py-3 font-medium">Spécification</th>
                          <th className="px-6 py-3 font-medium text-right">Quantité</th>
                          <th className="px-6 py-3 font-medium text-right">Prix Unitaire (CFA)</th>
                          <th className="px-6 py-3 font-medium text-right">Sous-total (CFA)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(viewingOrder.items || []).map((it: any, idx: number) => {
                          const qty = Number(it.quantity) || 0;
                          const unitPrice = Number(it.unitPrice) || 0;
                          const subtotal = Number(it.totalPrice) || (qty * unitPrice);
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-6 py-4 font-semibold text-gray-900">{translateProduct(it)}</td>
                              <td className="px-6 py-4">{translateColor(it.color)}</td>
                              <td className="px-6 py-4 text-gray-500 font-mono text-xs">{it.inventoryCode || it.materialCode}</td>
                              <td className="px-6 py-4 text-gray-500">{it.specification || '-'}</td>
                              <td className="px-6 py-4 text-right font-medium text-gray-900">{qty.toLocaleString('fr-FR')}</td>
                              <td className="px-6 py-4 text-right text-gray-600 font-mono">{unitPrice.toLocaleString('fr-FR')}</td>
                              <td className="px-6 py-4 text-right font-medium font-mono text-blue-600">
                                {Math.round(subtotal).toLocaleString('fr-FR')}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-50 border-t border-gray-200">
                          <td colSpan={4} className="px-6 py-4 text-right font-bold text-gray-700">Quantité Totale :</td>
                          <td className="px-6 py-4 text-right font-bold text-gray-900 text-lg">
                            {(viewingOrder.items || []).reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0).toLocaleString('fr-FR')}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-700">Montant Total :</td>
                          <td className="px-6 py-4 text-right font-bold text-blue-600 text-lg font-mono">
                            CFA {Math.round(viewingOrder.totalAmount || 0).toLocaleString('fr-FR')}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Back button */}
                <div className="flex justify-start mb-12">
                  <button
                    onClick={() => setViewingOrder(null)}
                    className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg text-sm transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Retour à la liste des commandes</span>
                  </button>
                </div>
              </div>
            ) : (
              /* ORDER LIST VIEW */
              <div className="w-full max-w-7xl">
                <div className="flex flex-col gap-4 mb-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-xl font-bold text-gray-800">
                        Mes Commandes ({displayedOrders.length})
                      </h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Consultez l'historique complet de vos commandes et le statut des livraisons.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={fetchCustomerOrders}
                        disabled={loadingOrders}
                        className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                        title="Actualiser l'historique des commandes"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin' : ''}`} />
                        <span>{loadingOrders ? 'Actualisation...' : 'Actualiser'}</span>
                      </button>

                      <button 
                        onClick={() => {
                          setActiveTab('order');
                          setCurrentStep(1);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors cursor-pointer shadow-sm text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Nouvelle Commande</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Card */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-end">
                    {/* N° Commande filter */}
                    <div className="flex-1 relative">
                      <label className="block text-xs font-medium text-gray-500 mb-1">N° de Commande</label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsOrderIdFilterOpen(!isOrderIdFilterOpen);
                        }}
                        className="w-full text-sm py-2 px-3 text-left bg-white border border-gray-300 rounded-lg flex justify-between items-center hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100 cursor-pointer"
                      >
                        <span className="truncate text-gray-700 font-medium">
                          {orderIdFilter.length === 0 
                            ? 'Tous les numéros (Sélection multiple)' 
                            : `Sélectionné (${orderIdFilter.length})`}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOrderIdFilterOpen ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {isOrderIdFilterOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => {
                            setIsOrderIdFilterOpen(false);
                            setOrderIdSearch('');
                          }} />
                          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto flex flex-col p-2 min-w-[220px]">
                            <input
                              type="text"
                              className="w-full text-xs border border-gray-200 rounded-lg p-2 mb-2 outline-none focus:border-blue-500"
                              placeholder="Rechercher par N° de commande..."
                              value={orderIdSearch}
                              onChange={(e) => setOrderIdSearch(e.target.value)}
                            />
                            <div className="flex justify-between gap-2 mb-2 px-1 pb-2 border-b border-gray-100 text-xs">
                              <button
                                type="button"
                                onClick={() => setOrderIdFilter([])}
                                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                              >
                                Tout Réinitialiser
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const matches = displayedCustomerOrderIds.filter(id => id.toLowerCase().includes(orderIdSearch.toLowerCase()));
                                  setOrderIdFilter(prev => Array.from(new Set([...prev, ...matches])));
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                              >
                                Tout cocher
                              </button>
                            </div>
                            <div className="overflow-y-auto max-h-48 divide-y divide-gray-50">
                              {displayedCustomerOrderIds
                                .filter(id => id.toLowerCase().includes(orderIdSearch.toLowerCase()))
                                .map(id => {
                                  const isChecked = orderIdFilter.includes(id);
                                  return (
                                    <label key={id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs rounded select-none">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          if (isChecked) {
                                            setOrderIdFilter(orderIdFilter.filter(x => x !== id));
                                          } else {
                                            setOrderIdFilter([...orderIdFilter, id]);
                                          }
                                        }}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                      />
                                      <span className="text-gray-700 font-mono">{id}</span>
                                    </label>
                                  );
                                })}
                              {displayedCustomerOrderIds.filter(id => id.toLowerCase().includes(orderIdSearch.toLowerCase())).length === 0 && (
                                <div className="text-center py-4 text-xs text-gray-400">
                                  Aucun numéro correspondant
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Statut filter */}
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Statut de Commande</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full text-sm py-2 px-3 bg-white border border-gray-300 rounded-lg hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100 outline-none cursor-pointer"
                      >
                        <option value="全部">Tous les statuts</option>
                        <option value="待销售审核">En attente commercial</option>
                        <option value="新建">Nouveau</option>
                        <option value="助销已确认">Confirmé (Assistance)</option>
                        <option value="财务已确认">Confirmé (Comptabilité)</option>
                        <option value="已通知备货">Préparation commande</option>
                        <option value="已叫车">Camion affrété</option>
                        <option value="已发货">Expédié / Livré</option>
                        <option value="销售退回">Rejeté commercial</option>
                      </select>
                    </div>

                    {/* Search */}
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Recherche</label>
                      <div className="relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          className="w-full text-sm pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100 outline-none"
                          placeholder="N° commande, article, note..."
                          value={orderSearchKeyword}
                          onChange={(e) => setOrderSearchKeyword(e.target.value)}
                        />
                        {orderSearchKeyword && (
                          <button
                            onClick={() => setOrderSearchKeyword('')}
                            className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Orders Table & Cards */}
                {displayedOrders.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                      {customerOrders.length === 0 ? 'Aucune commande enregistrée' : 'Aucune commande correspondante'}
                    </h3>
                    <p className="text-gray-500 text-sm">
                      {customerOrders.length === 0 
                        ? 'Cliquez sur le bouton « Nouvelle Commande » pour passer votre première commande.' 
                        : 'Veuillez réinitialiser les filtres pour afficher vos commandes.'}
                    </p>
                  </div>
                ) : (
                  <div className="bg-white sm:rounded-xl sm:border border-gray-200 overflow-hidden sm:shadow-sm">
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                          <tr>
                            <th className="px-6 py-4 font-medium">N° Commande</th>
                            <th className="px-6 py-4 font-medium">Commercial</th>
                            <th className="px-6 py-4 font-medium">Nom du Client</th>
                            <th className="px-6 py-4 font-medium">Montant</th>
                            <th className="px-6 py-4 font-medium">Statut</th>
                            <th className="px-6 py-4 font-medium">Priorité</th>
                            <th className="px-6 py-4 font-medium">Date</th>
                            <th className="px-6 py-4 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {displayedOrders.map((order) => {
                            let rowClass = "hover:bg-gray-50 transition-colors";
                            if (order.status === '待销售审核') rowClass = "bg-amber-50/40 hover:bg-amber-100/50 transition-colors";
                            else if (order.status === '销售退回') rowClass = "bg-red-50/50 hover:bg-red-100/60 transition-colors";
                            else if (order.status === '已发货') rowClass = "bg-emerald-50/40 hover:bg-emerald-100/50 transition-colors";

                            const dateFormatted = order.createdAt?.seconds 
                              ? new Date(order.createdAt.seconds * 1000).toLocaleString('fr-FR', {
                                  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                })
                              : (order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString('fr-FR') : '-');

                            return (
                              <tr key={order._docId} className={rowClass}>
                                <td 
                                  className="px-6 py-4 font-medium text-blue-600 cursor-pointer hover:text-blue-800 font-mono"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadFrenchPDF(order);
                                  }}
                                  title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                                >
                                  <div className="flex items-center gap-1.5 group">
                                    {generatingPdf && pdfTargetOrder?._docId === order._docId ? (
                                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent shrink-0" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5 text-blue-500 group-hover:text-blue-700 shrink-0" />
                                    )}
                                    <span className="underline group-hover:decoration-blue-700 font-bold">{order.id}</span>
                                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1 py-0.2 rounded font-sans font-semibold">PDF</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-gray-600">
                                  {order.customer?.['销售'] || order.salespersonName || '-'}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-medium text-gray-900">{order.customer?.['客户名'] || customer?.['客户名']}</div>
                                </td>
                                <td className="px-6 py-4 font-medium font-mono text-gray-900">
                                  CFA {order.totalAmount?.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </td>
                                <td className="px-6 py-4">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                    order.status === '待销售审核'
                                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                      : order.status === '销售退回'
                                      ? 'bg-red-100 text-red-900 border border-red-300'
                                      : order.status === '已发货'
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                      : order.status === '草稿' 
                                      ? 'bg-gray-100 text-gray-700 border border-gray-200' 
                                      : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    {translateStatus(order.status)}
                                  </span>
                                </td>
                                <td className="px-6 py-4">
                                  {order.isPriority && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 inline-block" />}
                                </td>
                                <td className="px-6 py-4 text-gray-500 text-xs">
                                  {dateFormatted}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => setViewingOrder(order)}
                                      className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 hover:bg-blue-50 rounded transition-colors cursor-pointer text-xs"
                                    >
                                      Détails
                                    </button>
                                    <button
                                      onClick={() => downloadFrenchPDF(order)}
                                      disabled={generatingPdf}
                                      className="text-gray-600 hover:text-gray-900 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors cursor-pointer text-xs flex items-center gap-1 disabled:opacity-50"
                                      title="Télécharger Bon de Commande (PDF)"
                                    >
                                      {generatingPdf && pdfTargetOrder?._docId === order._docId ? (
                                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-current border-t-transparent" />
                                      ) : (
                                        <Download className="w-3.5 h-3.5" />
                                      )}
                                      <span>PDF</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View Cards */}
                    <div className="sm:hidden flex flex-col gap-3 p-2 bg-gray-50">
                      {displayedOrders.map((order) => {
                        let cardClass = "bg-white p-4 rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-all cursor-pointer";
                        if (order.status === '待销售审核') cardClass = "bg-amber-50/70 border-amber-300 p-4 rounded-xl shadow-sm active:scale-[0.98] cursor-pointer";
                        else if (order.status === '销售退回') cardClass = "bg-red-50/70 border-red-300 p-4 rounded-xl shadow-sm active:scale-[0.98] cursor-pointer";
                        else if (order.status === '已发货') cardClass = "bg-emerald-50/70 border-emerald-300 p-4 rounded-xl shadow-sm active:scale-[0.98] cursor-pointer";

                        const dateFormatted = order.createdAt?.seconds 
                          ? new Date(order.createdAt.seconds * 1000).toLocaleDateString('fr-FR')
                          : (order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('fr-FR') : '-');

                        return (
                          <div 
                            key={order._docId} 
                            className={cardClass}
                            onClick={() => setViewingOrder(order)}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadFrenchPDF(order);
                                  }}
                                  className="flex items-center gap-1 text-sm font-bold text-blue-600 font-mono hover:underline cursor-pointer group"
                                  title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                                >
                                  {generatingPdf && pdfTargetOrder?._docId === order._docId ? (
                                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent shrink-0" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5 text-blue-500 group-hover:text-blue-700 shrink-0" />
                                  )}
                                  <span>#{order.id}</span>
                                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1 py-0.2 rounded font-sans font-semibold">PDF</span>
                                </button>
                                {order.isPriority && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                order.status === '待销售审核'
                                  ? 'bg-amber-200 text-amber-900 border-amber-400'
                                  : order.status === '销售退回'
                                  ? 'bg-red-200 text-red-900 border-red-400'
                                  : order.status === '草稿'
                                  ? 'bg-gray-100 text-gray-700 border-gray-200'
                                  : 'bg-blue-600 text-white border-blue-600'
                              }`}>
                                {translateStatus(order.status)}
                              </span>
                            </div>
                            <div className="mb-4">
                              <div className="font-bold text-gray-900 text-lg leading-tight">{order.customer?.['客户名'] || customer?.['客户名']}</div>
                              <div className="flex justify-between mt-1">
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <User className="w-3 h-3" /> {order.customer?.['销售'] || order.salespersonName || '-'}
                                </span>
                                <span className="text-xs text-gray-400">{dateFormatted}</span>
                              </div>
                            </div>
                            <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                              <div className="font-bold text-blue-600 text-base font-mono">
                                CFA {order.totalAmount?.toLocaleString('fr-FR')}
                              </div>
                              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => setViewingOrder(order)}
                                  className="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold cursor-pointer"
                                >
                                  Détails
                                </button>
                                <button
                                  onClick={() => downloadFrenchPDF(order)}
                                  disabled={generatingPdf}
                                  className="p-1.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer disabled:opacity-50"
                                  title="PDF"
                                >
                                  {generatingPdf && pdfTargetOrder?._docId === order._docId ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                                  ) : (
                                    <Download className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Success Modal */}
      {submitSuccessOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-200 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-green-50 border border-green-200 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              Commande transmise avec succès !
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              N° Commande : <strong className="font-mono text-blue-600">{submitSuccessOrder.orderId}</strong>
            </p>

            <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 text-left mb-5 leading-relaxed">
              <p className="font-semibold mb-1">
                📌 Prochaines étapes :
              </p>
              <p>
                Votre commercial assigné ({submitSuccessOrder.sales || 'vendeur'}) a bien reçu votre commande et procèdera rapidement à la validation et à la préparation de la livraison.
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setSubmitSuccessOrder(null);
                  setActiveTab('history');
                  fetchCustomerOrders();
                }}
                className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Voir mes commandes
              </button>
              <button
                onClick={() => {
                  setSubmitSuccessOrder(null);
                  setActiveTab('order');
                  setCurrentStep(1);
                }}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                Nouvelle commande
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Modal */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-xl overflow-hidden shadow-2xl p-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-4 right-4 bg-white/90 hover:bg-white text-gray-800 rounded-full p-2 shadow-lg cursor-pointer transition-all"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={zoomedImage} 
              alt="Produit agrandi" 
              className="max-w-full max-h-[85vh] object-contain mx-auto rounded-lg" 
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

      {/* Mobile PDF Modal (matches Sales logic for WeChat/WhatsApp share & preview) */}
      {mobilePdfModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-[99991] p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl relative border border-gray-100 flex flex-col my-auto max-h-[95vh]">
            {/* Close Button */}
            <button 
              onClick={() => {
                if (mobilePdfModal.url) {
                  URL.revokeObjectURL(mobilePdfModal.url);
                }
                setMobilePdfModal(prev => ({ ...prev, isOpen: false }));
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header Icon & Title */}
            <div className="flex items-center gap-3 mb-4 pr-8">
              <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                  PDF de Commande Généré
                </h3>
                <p className="text-xs text-gray-500 truncate">
                  {mobilePdfModal.filename}
                </p>
              </div>
            </div>

            {/* PDF Info Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-center">
              <FileText className="w-12 h-12 text-blue-500 mx-auto mb-2 opacity-80" />
              <div className="font-semibold text-sm text-gray-800 break-all mb-1">
                {mobilePdfModal.filename}
              </div>
              <div className="text-xs text-gray-500">
                Format: Document PDF officiel
              </div>
            </div>

            {/* WeChat Note if applicable */}
            {/MicroMessenger/i.test(navigator.userAgent) && (
              <div className="bg-amber-50/90 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-xl text-xs mb-4 flex items-start gap-2">
                <span className="text-sm shrink-0">💡</span>
                <div className="leading-snug">
                  <span className="font-semibold">Note WeChat : </span>
                  Si le téléchargement est bloqué dans WeChat, cliquez sur [···] puis 'Ouvrir dans le navigateur'.
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5">
              {navigator.canShare && mobilePdfModal.blob && (
                <button
                  onClick={async () => {
                    if (mobilePdfModal.blob) {
                      const file = new File([mobilePdfModal.blob], mobilePdfModal.filename, { type: 'application/pdf' });
                      try {
                        await navigator.share({
                          files: [file],
                          title: mobilePdfModal.filename,
                          text: `Bon de commande - ${activePdfOrder?.customer?.['客户名'] || customer?.['客户名'] || ''}`
                        });
                      } catch (err) {
                        console.error('Manual Web Share failed:', err);
                      }
                    }
                  }}
                  className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-blue-100 transition-all cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  Partager (WhatsApp / Système)
                </button>
              )}

              <a
                href={mobilePdfModal.url}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all text-center"
              >
                <Eye className="w-4 h-4 text-gray-600" />
                Visualiser le PDF
              </a>

              <a
                href={mobilePdfModal.url}
                download={mobilePdfModal.filename}
                className="w-full py-2.5 px-3 bg-white hover:bg-gray-50 text-gray-700 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 border border-gray-200 transition-all text-center"
              >
                <Download className="w-4 h-4 text-gray-500" />
                Télécharger le PDF
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Debt Order Details Modal (点击订单号查看订单信息) */}
      {viewingDebtOrder && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setViewingDebtOrder(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-auto border border-gray-200 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={generatingPdf && pdfTargetOrder?.id === viewingDebtOrder.orderNo}
                      onClick={() => {
                        const orderToExport = buildOrderFromDebt(viewingDebtOrder);
                        downloadFrenchPDF(orderToExport);
                      }}
                      className="text-base font-bold text-blue-600 hover:text-blue-800 hover:underline font-mono cursor-pointer flex items-center gap-1.5 text-left disabled:opacity-50"
                      title="Cliquer pour télécharger directement le Bon de Commande (PDF)"
                    >
                      <span>Commande #{viewingDebtOrder.orderNo || 'Détails'}</span>
                      {generatingPdf && pdfTargetOrder?.id === viewingDebtOrder.orderNo ? (
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent" />
                      ) : (
                        <Download className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                    {checkIsOverdue(viewingDebtOrder.dueDate) ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                        ÉCHU
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                        À JOUR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Aperçu de la commande et situation des paiements
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingDebtOrder(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
                title="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Order Info Card Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[11px] text-gray-500 block mb-0.5">Date d'échéance</span>
                  <strong className={`text-xs sm:text-sm font-mono block ${checkIsOverdue(viewingDebtOrder.dueDate) ? 'text-red-700 font-bold' : 'text-gray-900'}`}>
                    {viewingDebtOrder.dueDate}
                  </strong>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[11px] text-gray-500 block mb-0.5">Date de commande</span>
                  <strong className="text-xs sm:text-sm font-mono text-gray-900 block">
                    {viewingDebtOrder.businessDate || '-'}
                  </strong>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[11px] text-gray-500 block mb-0.5">Commercial</span>
                  <strong className="text-xs sm:text-sm text-gray-900 block truncate">
                    {viewingDebtOrder.salesperson || customer?.['销售'] || '-'}
                  </strong>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[11px] text-gray-500 block mb-0.5">Destination / Région</span>
                  <strong className="text-xs sm:text-sm text-gray-900 block truncate">
                    {viewingDebtOrder.city || '-'}
                  </strong>
                </div>
              </div>

              {/* Financial Summary Strip */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-100 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <span className="text-[11px] text-gray-500 block">Total de la commande</span>
                    <strong className="text-sm font-bold text-gray-900 font-mono">
                      CFA {Math.round(viewingDebtOrder.totalAmount || viewingDebtOrder.amount).toLocaleString('fr-FR')}
                    </strong>
                  </div>
                  {viewingDebtOrder.settledAmount !== undefined && viewingDebtOrder.settledAmount > 0 && (
                    <div>
                      <span className="text-[11px] text-emerald-700 block">Montant déjà réglé</span>
                      <strong className="text-sm font-bold text-emerald-700 font-mono">
                        CFA {Math.round(viewingDebtOrder.settledAmount).toLocaleString('fr-FR')}
                      </strong>
                    </div>
                  )}
                </div>

                <div className="text-right sm:text-right">
                  <span className="text-[11px] text-red-700 font-semibold block">Reste à payer (Impayé)</span>
                  <strong className="text-base font-bold text-red-700 font-mono">
                    CFA {Math.round(viewingDebtOrder.amount).toLocaleString('fr-FR')}
                  </strong>
                </div>
              </div>

              {/* Remarks if any */}
              {viewingDebtOrder.remarks && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                  <strong className="block text-amber-950 font-semibold mb-1 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-amber-700" />
                    Remarques :
                  </strong>
                  <div className="whitespace-pre-wrap font-mono text-[11px] text-amber-900">
                    {viewingDebtOrder.remarks}
                  </div>
                </div>
              )}

              {/* Products Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-gray-500" />
                    Articles de la commande
                    {viewingDebtOrder.items && (
                      <span className="text-gray-400 font-normal text-[11px]">
                        ({viewingDebtOrder.items.length} articles)
                      </span>
                    )}
                  </h4>
                </div>

                {viewingDebtOrder.items && viewingDebtOrder.items.length > 0 ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead className="bg-gray-50 text-gray-600 font-semibold sticky top-0 border-b border-gray-200 z-10">
                          <tr>
                            <th className="p-2.5 text-center w-10">#</th>
                            <th className="p-2.5 font-sans">Désignation du produit</th>
                            <th className="p-2.5 font-sans">Catégorie</th>
                            <th className="p-2.5 text-right font-sans">Quantité</th>
                            <th className="p-2.5 text-right font-sans">P.U (CFA)</th>
                            <th className="p-2.5 text-right font-sans">Total (CFA)</th>
                            <th className="p-2.5 text-right font-sans text-red-700">Reste dû</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-800">
                          {viewingDebtOrder.items.map((item, itIdx) => (
                            <tr key={itIdx} className="hover:bg-gray-50/80 transition-colors">
                              <td className="p-2.5 text-center text-gray-400 text-[11px]">{itIdx + 1}</td>
                              <td className="p-2.5 font-semibold text-gray-900 font-sans">
                                {translateProduct(item)}
                              </td>
                              <td className="p-2.5 text-gray-500 font-sans text-[11px]">
                                {translateCategoryFr(item.category)}
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {item.quantity.toLocaleString('fr-FR')}
                              </td>
                              <td className="p-2.5 text-right text-gray-600">
                                {Math.round(item.unitPrice).toLocaleString('fr-FR')}
                              </td>
                              <td className="p-2.5 text-right font-semibold text-gray-900">
                                {Math.round(item.totalPrice).toLocaleString('fr-FR')}
                              </td>
                              <td className="p-2.5 text-right font-bold text-red-700">
                                {Math.round(item.unsettledAmount).toLocaleString('fr-FR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50/90 font-bold border-t border-gray-200 text-gray-900 sticky bottom-0">
                          <tr>
                            <td colSpan={3} className="p-2.5 text-right font-sans">
                              Total général :
                            </td>
                            <td className="p-2.5 text-right text-blue-700">
                              {viewingDebtOrder.items.reduce((s, it) => s + it.quantity, 0).toLocaleString('fr-FR')}
                            </td>
                            <td className="p-2.5"></td>
                            <td className="p-2.5 text-right text-gray-900">
                              CFA {Math.round(viewingDebtOrder.items.reduce((s, it) => s + it.totalPrice, 0)).toLocaleString('fr-FR')}
                            </td>
                            <td className="p-2.5 text-right text-red-700">
                              CFA {Math.round(viewingDebtOrder.items.reduce((s, it) => s + it.unsettledAmount, 0)).toLocaleString('fr-FR')}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 text-center text-xs text-gray-500">
                    Aucun article détaillé disponible pour cette commande.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 bg-gray-50/80">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={generatingPdf && pdfTargetOrder?.id === viewingDebtOrder.orderNo}
                  onClick={() => {
                    const orderToExport = buildOrderFromDebt(viewingDebtOrder);
                    downloadFrenchPDF(orderToExport);
                  }}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  title="Télécharger le Bon de Commande officiel en PDF"
                >
                  {generatingPdf && pdfTargetOrder?.id === viewingDebtOrder.orderNo ? (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Télécharger Bon de Commande (PDF)</span>
                </button>

                {(() => {
                  const matchedSystemOrder = allOrders.find(o => o.id === viewingDebtOrder.orderNo);
                  if (matchedSystemOrder) {
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setViewingDebtOrder(null);
                          setViewingOrder(matchedSystemOrder);
                          setActiveTab('history');
                        }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-4 h-4 text-blue-600" />
                        <span>Voir dans l'historique des commandes</span>
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>

              <button
                type="button"
                onClick={() => setViewingDebtOrder(null)}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold rounded-lg transition-colors cursor-pointer ml-auto"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Order Export Element (Identical to Sales logic: categories, product images, totals) */}
      {activePdfOrder && (
        <div 
          ref={orderExportRef} 
          style={{ 
            display: 'none', 
            position: 'static', 
            width: '200mm', 
            background: 'white', 
            padding: '10mm', 
            boxSizing: 'border-box', 
            color: 'black', 
            fontFamily: 'Arial, sans-serif' 
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ fontSize: '28px', margin: '0 0 10px 0', fontWeight: 'bold' }}>Bon de Commande</h1>
          </div>
          
          <div style={{ marginBottom: '20px', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ marginBottom: '5px' }}><strong>Client:</strong> {activePdfOrder.customer?.['客户名'] || customer?.['客户名']}</div>
              <div style={{ marginBottom: '5px' }}><strong>Code Client:</strong> {activePdfOrder.customer?.['客户代码'] || customer?.['客户代码'] || '-'}</div>
              <div style={{ marginBottom: '5px' }}><strong>Tél:</strong> {activePdfOrder.customer?.['电话号码'] || customer?.['电话号码'] || '-'}</div>
              <div><strong>Région:</strong> {activePdfOrder.customer?.['所在地区'] || customer?.['所在地区'] || '-'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ marginBottom: '5px' }}>
                <strong>Date:</strong> {
                  activePdfOrder.businessDate 
                    ? activePdfOrder.businessDate 
                    : (activePdfOrder.createdAt?.seconds 
                        ? new Date(activePdfOrder.createdAt.seconds * 1000).toLocaleDateString('fr-FR')
                        : (activePdfOrder.createdAt?.toDate ? activePdfOrder.createdAt.toDate().toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR')))
                }
              </div>
              <div>
                <strong>No. Commande:</strong> {
                  activePdfOrder.id?.toUpperCase().includes('NEW') 
                    ? 'NEW ORDER' 
                    : (activePdfOrder.id?.includes('-') ? activePdfOrder.id.toUpperCase() : (activePdfOrder.id?.length > 12 ? activePdfOrder.id.slice(-8).toUpperCase() : (activePdfOrder.id || '-').toUpperCase()))
                }
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                <th style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', width: '140px', fontWeight: 'bold', fontSize: '13px' }}>Image</th>
                <th style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '13px' }}>Désignation</th>
                <th style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', width: '60px', fontWeight: 'bold', fontSize: '13px' }}>Qté</th>
                <th style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', width: '90px', fontWeight: 'bold', fontSize: '13px' }}>P.U.</th>
                <th style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', width: '100px', fontWeight: 'bold', fontSize: '13px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const categories = [
                  { id: 'bassine', label: 'Bassine', check: (n: string) => n.toLowerCase().includes('盆') || n.toLowerCase().includes('bassine') },
                  { id: 'seau', label: 'Seau', check: (n: string) => n.toLowerCase().includes('桶') || n.toLowerCase().includes('尿壶') || n.toLowerCase().includes('seau') || n.toLowerCase().includes('urinal') },
                  { id: 'satala', label: 'Satalas&Goblet&Tasse', check: (n: string) => (n.toLowerCase().includes('壶') || n.toLowerCase().includes('杯') || n.toLowerCase().includes('阿拉丁神灯') || n.toLowerCase().includes('satala') || n.toLowerCase().includes('goblet') || n.toLowerCase().includes('tasse') || n.toLowerCase().includes('lampe')) && !(n.toLowerCase().includes('尿壶') || n.toLowerCase().includes('urinal')) },
                  { id: 'chaise', label: 'Tabouret&Chaise', check: (n: string) => n.toLowerCase().includes('椅') || n.toLowerCase().includes('凳') || n.toLowerCase().includes('chaise') || n.toLowerCase().includes('tabouret') },
                  { id: 'autres', label: 'Autres', check: () => true }
                ];

                const grouped: Record<string, any[]> = {};
                categories.forEach(c => grouped[c.id] = []);

                activePdfOrder.items?.forEach((item: any) => {
                  const name = `${item.materialName || ''} ${item.frenchName || ''} ${item.materialCode || ''}`;
                  const cat = categories.find(c => c.check(name));
                  if (cat) grouped[cat.id].push(item);
                });

                return categories.map(cat => {
                  const items = grouped[cat.id];
                  if (items.length === 0) return null;

                  // Group by material code to sum quantities
                  const materialGroups: Record<string, any> = {};
                  items.forEach(item => {
                    const code = item.materialCode || item.materialName;
                    if (!materialGroups[code]) {
                      materialGroups[code] = {
                        ...item,
                        quantity: 0,
                        totalPrice: 0
                      };
                    }
                    materialGroups[code].quantity += Number(item.quantity) || 0;
                    materialGroups[code].totalPrice += Number(item.totalPrice) || (Number(item.quantity) * Number(item.unitPrice)) || 0;
                  });
                  
                  const groupArray = Object.values(materialGroups);

                  return (
                    <React.Fragment key={cat.id}>
                      <tr style={{ background: '#f8f9fa', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                        <td colSpan={5} style={{ border: '1px solid #333', padding: '8px 10px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                          {cat.label}
                        </td>
                      </tr>
                      {groupArray.map((item: any, idx: number) => {
                        const priceData = findPriceItem(item);
                        const imageUrl = priceData?.['图片'];
                        
                        return (
                          <tr key={`${cat.id}-${idx}`} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                            <td style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                              {imageUrl ? (
                                <div style={{ width: '140px', height: '140px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', overflow: 'hidden' }}>
                                  <img 
                                    src={imageUrl} 
                                    alt="" 
                                    crossOrigin="anonymous"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : null}
                            </td>
                            <td style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', verticalAlign: 'middle', fontSize: '14px', textTransform: 'uppercase', fontWeight: 'bold' }}>
                              {translateProduct(item)}
                            </td>
                            <td style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', verticalAlign: 'middle', fontSize: '14px' }}>
                              {item.quantity}
                            </td>
                            <td style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', verticalAlign: 'middle', fontSize: '14px' }}>
                              {Math.round(item.unitPrice).toLocaleString()}
                            </td>
                            <td style={{ border: '1px solid #333', padding: '8px', textAlign: 'center', verticalAlign: 'middle', fontSize: '14px', fontWeight: 'bold' }}>
                              {Math.round(item.totalPrice).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                });
              })()}
              <tr>
                <td colSpan={4} style={{ border: '1px solid #333', padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px' }}>
                  Total Général
                </td>
                <td style={{ border: '1px solid #333', padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px', background: '#f8f9fa' }}>
                  {Math.round(activePdfOrder.totalAmount || 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Situation Financière & Impayés Client (100% French) */}
          {(() => {
            const stats = getCustomerCreditStats(activePdfOrder.customer || customer);
            const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
            if (!custDebts || (custDebts.length === 0 && totalCredit === 0)) return null;

            return (
              <div style={{ marginTop: '20px', border: '1.5px solid #dc2626', borderRadius: '6px', padding: '12px 14px', background: '#fffaf0', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #fecaca', paddingBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#991b1b' }}>
                    Situation Financière & Impayés Client
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#111827', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span>Total Crédit : <strong style={{ color: '#1d4ed8' }}>CFA {Math.round(totalCredit).toLocaleString('fr-FR')}</strong></span>
                    <span>Crédit Restant : <strong style={{ color: remainingCredit < 0 ? '#b91c1c' : '#15803d' }}>CFA {Math.round(remainingCredit).toLocaleString('fr-FR')}{remainingCredit < 0 ? ' (Dépassement)' : ''}</strong></span>
                    <span>Total Impayés : <strong style={{ color: '#b91c1c' }}>CFA {Math.round(totalDebt).toLocaleString('fr-FR')}</strong></span>
                  </div>
                </div>

                {overdueTotal > 0 && (
                  <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>⚠️ Impayés Échus :</span>
                    <span>CFA {Math.round(overdueTotal).toLocaleString('fr-FR')} ({overdueDebts.length} échéance(s) en retard)</span>
                  </div>
                )}

                {custDebts.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', background: '#ffffff', border: '1px solid #e5e7eb' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6', color: '#374151' }}>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold', width: '130px' }}>N° Commande</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>Date d'échéance</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>Montant (CFA)</th>
                        <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', width: '110px' }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {custDebts.map((d, dIdx) => {
                        const isOd = checkIsOverdue(d.dueDate);
                        return (
                          <tr key={dIdx} style={{ background: isOd ? '#fff5f5' : '#ffffff' }}>
                            <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', fontFamily: 'monospace', fontWeight: 'bold', color: '#1d4ed8' }}>
                              #{d.orderNo || '-'}
                            </td>
                            <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', fontWeight: isOd ? 'bold' : 'normal', color: isOd ? '#dc2626' : '#1f2937' }}>
                              {d.dueDate}
                            </td>
                            <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', fontWeight: isOd ? 'bold' : 'normal', color: isOd ? '#dc2626' : '#1f2937' }}>
                              CFA {Math.round(d.amount).toLocaleString('fr-FR')}
                            </td>
                            <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'center' }}>
                              {isOd ? (
                                <span style={{ color: '#dc2626', fontWeight: 'bold', background: '#fee2e2', padding: '2px 6px', borderRadius: '3px', fontSize: '11px', display: 'inline-block' }}>
                                  ÉCHU
                                </span>
                              ) : (
                                <span style={{ color: '#15803d', fontWeight: '500', fontSize: '11px', display: 'inline-block' }}>
                                  En cours
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
