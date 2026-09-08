import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ShoppingCart, User, Package, Plus, Trash2, Save, CheckCircle2, AlertCircle, CheckSquare, Square, ChevronDown, ChevronUp, LogOut, List, ArrowLeft, ChevronRight, Edit2, X, Users, Shield, Printer, Star, FileSpreadsheet, Bell, BellOff, Image as ImageIcon, Loader2, Share2, Download, Eye, Copy, Check, ExternalLink, FileText } from 'lucide-react';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';
import MaterialConfigurator from './components/MaterialConfigurator';
import { db, auth, OperationType, handleFirestoreError } from './firebase';
import { collection, addDoc, getDocs, onSnapshot, query, orderBy, doc, setDoc, getDoc, serverTimestamp, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User as FirebaseUser, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';

const SERVER_CHAN_SENDKEY: string = "SCT351962T35RzBwHGE2ohHRJ3U1HhfP7D";

async function getTelegramRecipients(usernames: string[], roles: string[] = []): Promise<string[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const chatIds: string[] = [];
    
    // Normalize lists
    const lowerUsernames = usernames.map(u => u.trim().toLowerCase());
    const lowerRoles = roles.map(r => r.trim().toLowerCase());

    snap.docs.forEach(doc => {
      const data = doc.data();
      const uName = (data.username || '').trim().toLowerCase();
      const uRole = (data.role || '').trim().toLowerCase();
      const chatId = data.telegramChatId;

      if (chatId) {
        const matchUsername = lowerUsernames.includes(uName);
        const matchRole = lowerRoles.includes(uRole);
        if (matchUsername || matchRole) {
          chatIds.push(chatId);
        }
      }
    });

    return Array.from(new Set(chatIds)); // Deduplicate
  } catch (err) {
    console.error("Failed to query telegram recipients:", err);
    return [];
  }
}

async function triggerNotification(options: {
  title: string;
  body: string;
  targetUsernames?: string[];
  targetRoles?: string[];
}) {
  // Telegram notification is deactivated as per user request
}

async function sendWeChatNotify(title: string, content: string) {
  if (!SERVER_CHAN_SENDKEY || SERVER_CHAN_SENDKEY === "YOUR_SENDKEY_HERE") {
    console.log("ServerChan SENDKEY is not configured or still draft. Skipping WeChat notification.");
    return;
  }
  try {
    const url = `https://sctapi.ftqq.com/${SERVER_CHAN_SENDKEY}.send`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        title: title,
        desp: content
      }).toString()
    });
    const result = await response.json();
    console.log("WeChat push result:", result);
  } catch (error) {
    console.error("WeChat push failed:", error);
  }
}

interface Customer {
  '客户名': string;
  '客户代码': string;
  '客户级别': string;
  '所在地区': string;
  '电话号码': string;
  '信用额度'?: string;
  '销售额'?: string;
  '销售': string;
  [key: string]: string | undefined;
}

interface InventoryItem {
  '物料名称': string;
  '颜色': string;
  '可用量': string;
  ' 物料编码 ': string;
  '规格型号'?: string;
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

interface DebtItem {
  dueDate: string;
  amount: number;
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
}

interface Order {
  _docId: string;
  id: string;
  status: string;
  customer?: Customer;
  items?: OrderItem[];
  remarks?: string;
  isPriority?: boolean;
  createdAt?: any;
  authorUid?: string;
  salespersonName?: string;
}

const RemarkImage = ({ imageId, onZoom }: { imageId: string, onZoom: (src: string) => void }) => {
  const [src, setSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    getDoc(doc(db, 'orderImages', imageId)).then(snap => {
      if (snap.exists()) setSrc(snap.data().dataUrl);
    }).finally(() => setLoading(false));
  }, [imageId]);

  if (loading) return <div className="w-24 h-24 bg-gray-100 animate-pulse rounded-lg flex items-center justify-center"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>;
  if (!src) return <div className="text-gray-400 text-xs italic">图片已失效</div>;
  
  return (
    <img 
      src={src} 
      className="max-w-full max-h-[200px] rounded-lg border border-gray-200 cursor-zoom-in active:opacity-80 transition-opacity print:max-h-full print:border-none" 
      onClick={() => onZoom(src)} 
      alt="附件"
    />
  );
};

export default function App() {
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'detail' | 'users'>('list');
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [printMode, setPrintMode] = useState<'normal' | 'french'>('normal');
  const [isEditingOrderId, setIsEditingOrderId] = useState(false);
  const [orderIdInput, setOrderIdInput] = useState('');
  const [orderRemarks, setOrderRemarks] = useState('');
  const [salesFilter, setSalesFilter] = useState<string[]>([]);
  const [orderIdFilter, setOrderIdFilter] = useState<string[]>([]);
  const [customerNameFilter, setCustomerNameFilter] = useState<string[]>([]);

  const [isSalesFilterOpen, setIsSalesFilterOpen] = useState(false);
  const [isOrderIdFilterOpen, setIsOrderIdFilterOpen] = useState(false);
  const [isCustomerFilterOpen, setIsCustomerFilterOpen] = useState(false);

  const [salesSearch, setSalesSearch] = useState('');
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const hiddenFileInput = useRef<HTMLInputElement>(null);

  const uploadImageFile = (file: File) => {
    if (!viewingOrder?._docId) return;
    
    setIsUploadingImage(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height = Math.round(height * MAX_WIDTH / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return setIsUploadingImage(false);
        ctx.drawImage(img, 0, 0, width, height);
        
        // compress heavily to save space
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6); 
        
        try {
          const imgDoc = await addDoc(collection(db, 'orderImages'), {
            dataUrl: compressedDataUrl,
            orderId: viewingOrder._docId,
            uploadedAt: serverTimestamp()
          });
          
          setRemarksInput(prev => prev + (prev.endsWith('\n') || !prev ? '' : '\n') + `[图片] [IMAGE:${imgDoc.id}]\n`);
        } catch (err) {
          console.error('Failed to upload image', err);
          alert('图片上传失败，请重试');
        } finally {
          setIsUploadingImage(false);
          if (hiddenFileInput.current) hiddenFileInput.current.value = '';
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadImageFile(file);
  };

  const handlePasteRemarks = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadImageFile(file);
          break;
        }
      }
    }
  };

  const orderExportRef = useRef<HTMLDivElement>(null);

  const handleGenerateOrderImage = async () => {
    if (!viewingOrder || !orderExportRef.current) {
      console.error('Missing order or orderExportRef');
      return;
    }
    
    setGeneratingImage(true);
    const element = orderExportRef.current;
    
    // Temporarily bring element into layout flow for html2canvas rendering
    const originalDisplay = element.style.display;
    const originalPosition = element.style.position;
    const originalLeft = element.style.left;
    const originalTop = element.style.top;
    
    element.style.display = 'block';
    element.style.position = 'static';
    element.style.left = '0';
    element.style.top = '0';

    try {
      // Ensure layout and images have settled
      await new Promise(r => setTimeout(r, 250));

      const canvas = await html2canvas(element, {
        scale: 2.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollY: 0,
        scrollX: 0
      });

      element.style.display = originalDisplay;
      element.style.position = originalPosition;
      element.style.left = originalLeft;
      element.style.top = originalTop;

      const customerName = viewingOrder.customer?.['客户名'] || 'Client';
      const totalAmount = viewingOrder.items?.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0) || 0;
      const filename = `${customerName}_${Math.round(totalAmount)}.png`;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setGeneratingImage(false);
          alert(t('生成图片失败，请重试', 'Échec de la génération de l\'image'));
          return;
        }

        const url = URL.createObjectURL(blob);
        setGeneratingImage(false);

        setImageModal({
          isOpen: true,
          url,
          filename,
          blob,
          copied: false
        });

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
          // Native share on mobile if supported
          const file = new File([blob], filename, { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: filename,
                text: `Bon de commande - ${customerName}`
              });
            } catch (shareErr) {
              console.log('Mobile share dismissed', shareErr);
            }
          }
        } else {
          // Auto download on desktop
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }, 'image/png', 0.98);
    } catch (err: any) {
      console.error('Image Generation Error:', err);
      element.style.display = originalDisplay;
      element.style.position = originalPosition;
      element.style.left = originalLeft;
      element.style.top = originalTop;
      setGeneratingImage(false);
      alert(t('生成图片失败，请重试', 'Échec de la génération de l\'image'));
    }
  };

  const handleGenerateOrderPdf = async () => {
    if (!viewingOrder || !orderExportRef.current) {
      console.error('Missing order or orderExportRef');
      return;
    }
    
    setGeneratingPdf(true);
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

      const customerName = viewingOrder.customer?.['客户名'] || 'Client';
      const totalAmount = viewingOrder.items?.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0) || 0;
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
      };

      if (isMobile) {
        // First generate as Blob for preview / share modal on mobile
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
          alert(t('PDF生成失败，请重试', 'Échec de la génération du PDF'));
        });
      } else {
        // Desktop - Use standard save
        html2pdf().set(opt).from(element).save().then(() => {
          restoreElement();
        }).catch((err: any) => {
          console.error('PDF Generation Error:', err);
          restoreElement();
          alert(t('PDF生成失败，请重试', 'Échec de la génération du PDF'));
        });
      }
    } catch (err: any) {
      console.error('PDF Generation Setup Error:', err);
      element.style.display = originalDisplay;
      element.style.position = originalPosition;
      element.style.left = originalLeft;
      element.style.top = originalTop;
      setGeneratingPdf(false);
      alert(t('PDF生成失败，请重试', 'Échec de la génération du PDF'));
    }
  };

  const handleCopyImageToClipboard = async () => {
    if (!imageModal.blob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': imageModal.blob
          })
        ]);
        setImageModal(prev => ({ ...prev, copied: true }));
        setTimeout(() => {
          setImageModal(prev => ({ ...prev, copied: false }));
        }, 2500);
      } else {
        alert(t('您的浏览器不支持直接复制图片，请使用下载按钮', 'Votre navigateur ne supporte pas la copie directe'));
      }
    } catch (err) {
      console.error('Failed to copy image to clipboard', err);
      alert(t('复制到剪切板失败，请直接点击下载或长按/右键图片另存', 'Échec de la copie, veuillez télécharger l\'image'));
    }
  };

  const handleExportExcel = () => {
    if (!viewingOrder) return;
    
    const data = (viewingOrder.items || []).map((item: any) => ({
      '销售名': viewingOrder.customer?.['销售'] || '',
      '订单号': viewingOrder.id || '',
      '客户名': viewingOrder.customer?.['客户名'] || '',
      '物料名称': item.materialName || '',
      '颜色': item.color || '',
      '物料编码': item.inventoryCode || item.materialCode || '',
      '规格型号': item.specification || '',
      '数量': item.quantity || 0,
      '单价': item.unitPrice || 0,
      '总金额': item.totalPrice || 0
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Order");
    
    const fileName = `${viewingOrder.customer?.['客户名'] || 'Client'}_${viewingOrder.id || 'Order'}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };
  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [remarksInput, setRemarksInput] = useState('');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isHardDelete, setIsHardDelete] = useState(false);
  const [deleteUserConfirmId, setDeleteUserConfirmId] = useState<string | null>(null);
  const [editedPasswords, setEditedPasswords] = useState<Record<string, string>>({});
  const [inventoryWarningItems, setInventoryWarningItems] = useState<{ name: string; color: string; spec: string; requested: number; available: number }[] | null>(null);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const cached = localStorage.getItem('cached_orders');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [debts, setDebts] = useState<Record<string, DebtItem[]>>({});
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [loginLanguage, setLoginLanguage] = useState<'zh' | 'fr'>('zh');
  const isFrench = loginLanguage === 'fr';
  const [notifications, setNotifications] = useState<{id: string, message: string, type: 'info' | 'success' | 'warning', orderDocId?: string}[]>([]);
  const lastOrdersRef = useRef<Record<string, string>>({});
  const lastRemarksRef = useRef<Record<string, string>>({});
  const isInitialOrdersLoad = useRef(true);
  const [browserNotificationGranted, setBrowserNotificationGranted] = useState(false);

  const [publicUsers, setPublicUsers] = useState<{username: string, role: string}[]>(() => {
    try {
      const cached = localStorage.getItem('cached_public_users');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  useEffect(() => {
    if ('Notification' in window) {
      setBrowserNotificationGranted(Notification.permission === 'granted');
    }
    // Fetch users for login dropdown directly from users collection
    getDocs(collection(db, 'users')).then(snap => {
      const usersList = snap.docs.map(doc => ({ username: doc.data().username, role: doc.data().role || '无角色' })).filter(u => u.username);
      setPublicUsers(usersList);
      try {
        localStorage.setItem('cached_public_users', JSON.stringify(usersList));
      } catch (e) {}
    }).catch(e => {
      console.error("Failed to load public users:", e);
      handleFirestoreError(e, OperationType.LIST, 'users');
      if (e.message && (e.message.includes('Quota') || e.message.includes('quota'))) {
        setQuotaExceeded(true);
      }
      try {
        const cached = localStorage.getItem('cached_public_users');
        if (cached) setPublicUsers(JSON.parse(cached));
      } catch (err) {}
    });

    // Listen to system settings (maintenance mode)
    const unsubSystem = onSnapshot(doc(db, 'settings', 'system'), (docSnap) => {
      if (docSnap.exists()) {
        setMaintenanceMode(!!docSnap.data().maintenance);
      } else {
        setMaintenanceMode(false);
      }
    }, (error) => {
      console.error("Failed to watch system settings:", error);
      handleFirestoreError(error, OperationType.GET, 'settings/system');
      if (error.message && (error.message.includes('Quota') || error.message.includes('quota'))) {
        setQuotaExceeded(true);
      }
    });

    return () => {
      unsubSystem();
    };
  }, []);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('您的浏览器不支持系统级通知');
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationGranted(permission === 'granted');
  };

  const addNotification = useCallback((message: string, type: 'info' | 'success' | 'warning' = 'info', orderDocId?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications(prev => [...prev, { id, message, type, orderDocId }]);
    
    // Browser System Notification
    if (Notification.permission === 'granted') {
      try {
        new Notification('订单系统提醒', {
          body: message,
          icon: '/favicon.ico'
        });
      } catch (e) {
        console.error('Failed to show browser notification', e);
      }
    }

    // ServerChan WeChat push
    sendWeChatNotify(
      message,
      `### 🔔 订单系统新通知\n\n**内容**：${message}\n\n* **通知级别**：${type}\n* **通知时间**：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n---\n*提示：此消息由订单管理系统自动发送，您可打开系统查看详情。*`
    );

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 10000);
  }, []);

  const t = (zh: string, fr: string) => isFrench ? fr : zh;

  const translateProduct = (item: any) => {
    if (!isFrench) {
      // If we are in Chinese mode, but the name is already French (starts with BASSINE etc.), try to find Chinese name
      if (/^[A-Z]/.test(item.materialName || '')) {
         const p = prices.find(p => p['物料代码'] === item.materialName || getFrenchName(p) === item.materialName);
         if (p) return p['物料名称'];
      }
      return item.materialName;
    }
    
    // In French mode
    const priceItem = prices.find(p => p['物料名称'] === item.materialName || p['物料代码'] === item.materialCode);
    if (priceItem) {
      const frName = getFrenchName(priceItem);
      if (frName) return frName;
    }
    return item.materialName;
  };

  function getFrenchName(p: PriceItem | undefined) {
    if (!p) return '';
    // 强制采用 B 列（物料代码）作为第一优先级
    return p['物料代码'] || p['法语名'] || p['法语名称'] || p['法语'] || p['Désignation'] || p['Designation'] || p['Nom du produit'] || p['Description'] || '';
  }

  const translateStatus = (status: string) => {
    // Mapping for both directions to ensure dynamic translation in logs
    const mapping: Record<string, string> = {
      // CN to FR
      '新建': 'Nouveau',
      '待审核': 'En attente',
      '助销已确认': 'Confirmé (Ass.)',
      '财务已确认': 'Confirmé (Compta)',
      '已通知备货': 'Preparer les machandises',
      '已叫车': 'camion organise',
      '已发货': 'livrer',
      '已拒绝': 'Refusé',
      '已作废': 'Annulé',
      '已撤回': 'Retiré',
      '草稿': 'Brouillon',
      // FR to CN (for reverse mapping)
      'Nouveau': '新建',
      'En attente': '待审核',
      'Confirmé (Ass.)': '助销已确认',
      'Confirmé (Compta)': '财务已确认',
      'Preparer les machandises': '已通知备货',
      'camion organise': '已叫车',
      'livrer': '已发货',
      'Refusé': '已拒绝',
      'Annulé': '已作废',
      'Retiré': '已撤回',
      'Brouillon': '草稿'
    };

    if (isFrench) {
      // If target is French, and it's already French, return as is; if Chinese, translate.
      return mapping[status] || status;
    } else {
      // If target is Chinese, and it's French, translate back; if Chinese, return as is.
      const reverseMap: Record<string, string> = {
        'Nouveau': '新建', 'En attente': '待审核', 'Confirmé (Ass.)': '助销已确认',
        'Confirmé (Compta)': '财务已确认', 'Preparer les machandises': '已通知备货',
        'camion organise': '已叫车', 'livrer': '已发货', 'Refusé': '已拒绝',
        'Annulé': '已作废', 'Retiré': '已撤回', 'Brouillon': '草稿'
      };
      return reverseMap[status] || status;
    }
  };

  const translateColor = (color: string) => {
    if (!isFrench) return color;
    const colorMap: Record<string, string> = {
      '红色': 'Rouge',
      '蓝色': 'Bleu',
      '绿色': 'Vert',
      '黄色': 'Jaune',
      '黑色': 'Noir',
      '白色': 'Blanc',
      '紫色': 'Violet',
      '橙色': 'Orange',
      '粉色': 'Rose',
      '灰色': 'Gris',
      '咖啡色': 'Marron',
      '棕色': 'Brun',
      '金色': 'Or',
      '银色': 'Argent',
      '米色': 'Beige',
      '混色': 'Mélange',
      '青色': 'Cyan',
      '深蓝色': 'Bleu Foncé',
      '天蓝色': 'Bleu Ciel'
    };
    return colorMap[color] || color;
  };

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

  const checkIsOverdue = (dueDateStr: string): boolean => {
    if (!dueDateStr) return false;
    const normalized = parseDateForComparison(dueDateStr);
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return normalized < todayStr;
  };

  const isLineOverdue = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (
      trimmed.includes('已逾期') || 
      trimmed.includes('逾期') || 
      trimmed.includes('已超额') || 
      trimmed.includes('超额') || 
      trimmed.toLowerCase().includes('overdue') || 
      trimmed.toLowerCase().includes('en retard') || 
      trimmed.toLowerCase().includes('échu') ||
      trimmed.toLowerCase().includes('dépassement')
    ) {
      return true;
    }
    const dateMatch = trimmed.match(/^(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})/);
    if (dateMatch) {
      return checkIsOverdue(dateMatch[1]);
    }
    const anyDateMatch = trimmed.match(/(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})/);
    if (anyDateMatch) {
      return checkIsOverdue(anyDateMatch[1]);
    }
    return false;
  };

  const getCustomerDebts = (customer: Partial<Customer> | null | undefined): DebtItem[] => {
    if (!customer) return [];
    const directCode = (customer['客户代码'] || '').trim();
    if (directCode) {
      if (debts[directCode]) return debts[directCode];
      if (debts[directCode.toUpperCase()]) return debts[directCode.toUpperCase()];
      if (debts[directCode.toLowerCase()]) return debts[directCode.toLowerCase()];
    }
    const custName = (customer['客户名'] || '').trim().toLowerCase();
    if (custName) {
      if (debts[custName]) return debts[custName];
      const matched = customers.find(c => (c['客户名'] || '').trim().toLowerCase() === custName);
      const code = (matched?.['客户代码'] || '').trim();
      if (code) {
        if (debts[code]) return debts[code];
        if (debts[code.toUpperCase()]) return debts[code.toUpperCase()];
      }
    }
    return [];
  };

  const getCustomerCreditStats = (customer: Partial<Customer> | null | undefined) => {
    if (!customer) {
      return { totalCredit: 0, totalDebt: 0, remainingCredit: 0, custDebts: [] as DebtItem[], overdueTotal: 0, overdueDebts: [] as DebtItem[] };
    }
    const custDebts = getCustomerDebts(customer);
    const totalDebt = custDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
    const overdueDebts = custDebts.filter(d => checkIsOverdue(d.dueDate));
    const overdueTotal = overdueDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

    let rawCredit = String(customer['信用额度'] || '').replace(/,/g, '').trim();
    if (!rawCredit) {
      const custCode = (customer['客户代码'] || '').trim().toLowerCase();
      const custName = (customer['客户名'] || '').trim().toLowerCase();
      const matched = customers.find(c => 
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
  };

  const formatCustomerDebtLines = (customer: Partial<Customer> | null | undefined): string => {
    if (!customer) return '';
    const { totalCredit, remainingCredit, custDebts } = getCustomerCreditStats(customer);
    
    const lines: string[] = [];

    const formattedTotalCredit = `CFA ${Math.round(totalCredit).toLocaleString('zh-CN')}`;
    const formattedRemainingCredit = `CFA ${Math.round(remainingCredit).toLocaleString('zh-CN')}`;
    lines.push(`总信用额度: ${formattedTotalCredit}`);
    lines.push(`所剩信用额度: ${formattedRemainingCredit}${remainingCredit < 0 ? ' (已超额)' : ''}`);

    if (custDebts && custDebts.length > 0) {
      custDebts.forEach(d => {
        const isOd = checkIsOverdue(d.dueDate);
        const formattedAmount = `CFA ${Math.round(d.amount).toLocaleString('zh-CN')}`;
        lines.push(`${d.dueDate} ${formattedAmount}${isOd ? ' (已逾期)' : ''}`);
      });
    }

    return lines.join('\n');
  };

  const getCustomerNote = (customer: Partial<Customer> | null | undefined): string => {
    if (!customer) return '';
    const code = (customer['客户代码'] || '').trim();
    if (code) {
      return customer['备注'] || '';
    } else {
      const name = (customer['客户名'] || '').trim();
      const cleanName = name.replace(/\s*\(client detail\)/i, '').trim();
      const region = (customer['所在地区'] || '').trim();
      return `(client detail)${cleanName}/${region || '-'}`;
    }
  };

  const renderRemarksWithRedOverdue = (text: string | undefined | null) => {
    if (!text) return null;
    const lines = String(text).split('\n');
    return (
      <div className="space-y-0.5">
        {lines.map((line, idx) => {
          const overdue = isLineOverdue(line);
          return (
            <div 
              key={idx} 
              className={overdue ? 'text-red-600 font-bold print:text-red-600' : 'text-gray-800 print:text-black'}
              style={overdue ? { color: '#dc2626', fontWeight: 600 } : undefined}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  };


  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('销售');

  const [isManualLogin, setIsManualLogin] = useState(false);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [oldSelfPassword, setOldSelfPassword] = useState('');
  const [newSelfPassword, setNewSelfPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });

  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // Force non-admin active sessions out when maintenance mode turns on
  useEffect(() => {
    if (maintenanceMode && currentUser && userRole && userRole !== 'admin' && userRole !== 'pending') {
      signOut(auth).then(() => {
        setLoginError(' é̙͍͇̕ç͠_̭̖d̲̱_̝̀p͕̱_̧d̗̹v̸̰_̶̮m̝̣_̷͓x̗͟9龘爨灪 [SYSTEM_MAINTENANCE_ERROR_503_ILLEGAL_ACCESS_DENIED_0x80244007]');
      });
    }
  }, [maintenanceMode, currentUser, userRole]);

  const formatInventoryUpdateTime = (timeStr: string) => {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) {
        return timeStr; // Legacy format fallback
      }

      // Format local browser time
      const locY = date.getFullYear();
      const locM = String(date.getMonth() + 1).padStart(2, '0');
      const locD = String(date.getDate()).padStart(2, '0');
      const locH = String(date.getHours()).padStart(2, '0');
      const locMin = String(date.getMinutes()).padStart(2, '0');
      const locSec = String(date.getSeconds()).padStart(2, '0');
      return `${locY}/${locM}/${locD} ${locH}:${locMin}:${locSec}`;
    } catch (e) {
      return timeStr;
    }
  };

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [inventoryUpdateTime, setInventoryUpdateTime] = useState<string>('');
  const [refreshingInventory, setRefreshingInventory] = useState<boolean>(false);

  const refreshInventory = async () => {
    setRefreshingInventory(true);
    try {
      const res = await fetch(`/api/inventory?_t=${Date.now()}`);
      if (res.ok) {
        const result = await res.json();
        setInventory(result.data);
        setInventoryUpdateTime(result.lastChanged);
      }
    } catch (err) {
      console.error('Failed to refresh inventory:', err);
    } finally {
      setRefreshingInventory(false);
    }
  };

  const [pendingWarehouseStatuses, setPendingWarehouseStatuses] = useState<Record<string, string>>({});
  
  const [selectedCustomerIndex, setSelectedCustomerIndex] = useState<string>('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState<boolean>(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Form state for new item
  const [selectedMaterialCodes, setSelectedMaterialCodes] = useState<string[]>([]);
  const [draftOrderItems, setDraftOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [selectedSalesInCreate, setSelectedSalesInCreate] = useState<string>('');
  
  const [editableCustomer, setEditableCustomer] = useState<Partial<Customer> | null>(null);
  const [isCustomerNoteManuallyEdited, setIsCustomerNoteManuallyEdited] = useState(false);
  
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedCategory, setSelectedCategory] = useState<string>('盆系列');

  const [expandedMaterials, setExpandedMaterials] = useState<Record<string, boolean>>({});
  const [generatedOrderId, setGeneratedOrderId] = useState<string>('');
  const [isOrderIdEdited, setIsOrderIdEdited] = useState<boolean>(false);

  const [imageModal, setImageModal] = useState<{
    isOpen: boolean;
    url: string;
    filename: string;
    blob: Blob | null;
    copied: boolean;
  }>({
    isOpen: false,
    url: '',
    filename: '',
    blob: null,
    copied: false
  });

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

  const resetForm = useCallback(() => {
    setEditingOrderId(null);
    setEditableCustomer(null);
    setSelectedCustomerIndex('');
    setCustomerSearchQuery('');
    setIsCustomerDropdownOpen(false);
    setIsCustomerNoteManuallyEdited(false);
    
    // Default sales if user is a '销售'
    if (userRole === '销售' && userName) {
      setSelectedSalesInCreate(userName);
    } else {
      setSelectedSalesInCreate('');
    }

    setDraftOrderItems({});
    setSelectedMaterialCodes([]);
    setGeneratedOrderId('');
    setIsOrderIdEdited(false);
    setOrderRemarks('');
    setCurrentStep(1);
  }, [userRole, userName]);

  const handleUpdateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const order = orders.find(o => o._docId === orderId);
      if (!order) return;

      const now = new Date();
      const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const displayName = userName || currentUser?.email?.split('@')[0] || 'Unknown';
      
      const logMsg = isFrench 
        ? `[Log Système ${timestamp} ${displayName}]: Statut de commande mis à jour à 【${translateStatus(newStatus)}】`
        : `[系统日志 ${timestamp} ${displayName}]: 将订单状态更新为 【${newStatus}】`;
      
      const logEntry = logMsg;
      const updatedRemarks = order.remarks ? `${logEntry}\n${order.remarks}` : logEntry;

      await updateDoc(doc(db, 'orders', orderId), { 
        status: newStatus,
        remarks: updatedRemarks,
        updatedAt: serverTimestamp()
      });

      if (viewingOrder && viewingOrder._docId === orderId) {
        setViewingOrder({ ...viewingOrder, status: newStatus, remarks: updatedRemarks });
      }

      // Asynchronously trigger Telegram / WeChat personalized notifications
      try {
        const targets: { usernames: string[], roles: string[] } = { usernames: [], roles: [] };

        if (newStatus === '新建') {
          targets.roles.push('助销');
        } else if (newStatus === '助销已确认') {
          targets.roles.push('财务');
        } else if (newStatus === '财务已确认') {
          targets.roles.push('仓管');
        } else {
          // Default: send to the salesperson associated with the order
          const salesName = (order.customer?.['销售'] || '').trim();
          if (salesName) {
            targets.usernames.push(salesName);
          }
        }

        const notifyBody = `*订单单号*: ${order.id}\n*更新状态*: ${newStatus}\n*操作时间*: ${timestamp}\n*操作人员*: ${displayName}`;
        triggerNotification({
          title: '订单状态更新提醒',
          body: notifyBody,
          targetUsernames: targets.usernames,
          targetRoles: targets.roles
        });
      } catch (eNotify) {
        console.error('Telegram notification on status update failed:', eNotify);
      }
    } catch (err) {
      console.error('Failed to update status', err);
      alert('更新状态失败');
    }
  };

  const handleTogglePriority = async (orderId: string, currentPriority: boolean) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { isPriority: !currentPriority });
      if (viewingOrder && viewingOrder._docId === orderId) {
        setViewingOrder({ ...viewingOrder, isPriority: !currentPriority });
      }
    } catch (err) {
      console.error('Failed to toggle priority', err);
      alert('更新优先状态失败');
    }
  };

  const handleEditOrder = (order: any) => {
    setEditingOrderId(order._docId);
    setEditableCustomer(order.customer);
    setIsCustomerNoteManuallyEdited(true);
    setSelectedCustomerIndex('');
    setOrderRemarks(order.remarks || '');
    
    const newDraft: Record<string, OrderItem[]> = {};
    const codes = new Set<string>();
    if (order.items) {
      order.items.forEach((item: any) => {
        codes.add(item.materialCode);
        if (!newDraft[item.materialCode]) newDraft[item.materialCode] = [];
        newDraft[item.materialCode].push(item);
      });
    }
    setDraftOrderItems(newDraft);
    setSelectedMaterialCodes(Array.from(codes));
    setGeneratedOrderId(order.id);
    setIsOrderIdEdited(true);
    setSelectedSalesInCreate(order.customer?.['销售'] || '');
    
    setCurrentStep(1);
    setCurrentView('create');
  };

  const handleSelectCustomer = (idxStr: string) => {
    setSelectedCustomerIndex(idxStr);
    setIsCustomerNoteManuallyEdited(false);
    if (idxStr === 'NEW') {
      const initialCust = {
        '客户名': '',
        '客户代码': '',
        '客户级别': 'A',
        '所在地区': '',
        '电话号码': '',
        '销售': selectedSalesInCreate
      };
      setEditableCustomer({
        ...initialCust,
        '备注': ''
      });
    } else {
      const cust = idxStr !== '' ? customers[Number(idxStr)] : null;
      if (cust) {
        setEditableCustomer({
          ...cust,
          '备注': cust['备注'] || ''
        });
      } else {
        setEditableCustomer(null);
      }
    }
  };

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
      setCurrentUser(user);
      if (user) {
        // Pre-load cached profile for instant, offline-capable UI
        try {
          const cachedProfile = localStorage.getItem(`user_profile_${user.uid}`);
          if (cachedProfile) {
            const parsed = JSON.parse(cachedProfile);
            if (parsed.role) setUserRole(parsed.role);
            if (parsed.username) setUserName(parsed.username);
            if (parsed.role === '助销') setLoginLanguage('fr');
          }
        } catch (e) {}

        const userRef = doc(db, 'users', user.uid);
        unsubUserDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            setUserRole(userData.role);
            setUserName(userData.username);
            try {
              localStorage.setItem(`user_profile_${user.uid}`, JSON.stringify(userData));
            } catch (e) {}
            if (userData.role === '助销') {
              setLoginLanguage('fr');
            }
          } else {
            const emailName = (user.email?.split('@')[0] || '').toLowerCase();
            if (emailName === 'admin' || emailName === 'admin123') {
              setUserRole('admin');
              setUserName(emailName);
            } else {
              setUserRole('pending');
              setUserName(null);
            }
          }
        }, (err) => {
          console.error('Failed to listen to user profile', err);
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
          if (err.message && (err.message.includes('Quota') || err.message.includes('quota'))) {
            setQuotaExceeded(true);
          }

          // Fallback if Firestore read quota is exhausted
          try {
            const cachedProfile = localStorage.getItem(`user_profile_${user.uid}`);
            if (cachedProfile) {
              const parsed = JSON.parse(cachedProfile);
              if (parsed.role) {
                setUserRole(parsed.role);
                setUserName(parsed.username);
                if (parsed.role === '助销') setLoginLanguage('fr');
                return;
              }
            }
          } catch (e) {}

          const emailName = user.email?.split('@')[0] || '';
          if (emailName.toLowerCase() === 'admin' || emailName.toLowerCase() === 'admin123') {
            setUserRole('admin');
            setUserName(emailName);
          } else {
            try {
              const cached = localStorage.getItem('cached_public_users');
              if (cached) {
                const list = JSON.parse(cached);
                const found = list.find((u: any) => u.username === emailName);
                if (found && found.role) {
                  setUserRole(found.role);
                  setUserName(found.username);
                  if (found.role === '助销') setLoginLanguage('fr');
                  return;
                }
              }
            } catch (e) {}
            setUserRole(prev => prev || 'pending');
            setUserName(prev => prev || emailName);
          }
        });
      } else {
        setUserRole(null);
        setUserName(null);
        setCurrentView('list');
        setViewingOrder(null);
      }
      setAuthReady(true);
    });
    return () => {
      unsubscribe();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  const userRoleRef = useRef(userRole);
  const userNameRef = useRef(userName);
  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    userRoleRef.current = userRole;
    userNameRef.current = userName;
    currentUserRef.current = currentUser;
  }, [userRole, userName, currentUser]);

  useEffect(() => {
    if (!authReady || !currentUser || userRole === 'pending') return;
    
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        _docId: doc.id,
        ...doc.data()
      })) as Order[];

      try {
        localStorage.setItem('cached_orders', JSON.stringify(ordersData));
      } catch (e) {}
      
      const filteredOrders = ordersData.filter((order) => {
        return true;
      });
      
      const statusWeight: Record<string, number> = {
        '草稿': -1,
        '新建': 0,
        '助销已确认': 1,
        '财务已确认': 2,
        '已通知备货': 3,
        '已叫车': 4,
        '已发货': 5
      };

      filteredOrders.sort((a, b) => {
        const weightA = statusWeight[a.status] ?? 99;
        const weightB = statusWeight[b.status] ?? 99;
        if (weightA !== weightB) {
          return weightA - weightB;
        }
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeB - timeA;
      });
      
      // Notification Logic using stable refs to prevent listener re-subscription loops
      const currentRole = userRoleRef.current;
      const currentUName = userNameRef.current;
      const currentU = currentUserRef.current;

      if (!isInitialOrdersLoad.current && filteredOrders.length > 0) {
        filteredOrders.forEach((order: any) => {
          const prevStatus = lastOrdersRef.current[order._docId];
          const prevRemarks = lastRemarksRef.current[order._docId];
          let shouldNotify = false;
          let message = '';

          // Status Change Notifications
          if (prevStatus !== order.status) {
            const currentSales = (order.customer?.['销售'] || '').trim().toLowerCase();
            const myName = (currentUName || '').trim().toLowerCase();
            const isOwnerByField = currentSales && myName && currentSales === myName;
            const isOwnerByUid = order.authorUid === currentU?.uid;
            const isMyOrder = isOwnerByField || isOwnerByUid;

            if (currentRole === '助销' && order.status === '新建') {
              shouldNotify = true;
              message = `【新订单】单号: ${order.id}`;
            } else if (currentRole === '财务' && order.status === '助销已确认') {
              shouldNotify = true;
              message = `【待确认】单号: ${order.id}`;
            } else if (currentRole === '仓管' && order.status === '财务已确认') {
              shouldNotify = true;
              message = `【待备货】单号: ${order.id}`;
            } else if ((currentRole === '销售' && isMyOrder) || currentRole === 'admin') {
              shouldNotify = true;
              message = `【状态更新】单号 ${order.id}: ${order.status}`;
            }
          }

          // Remark/Message Board Notifications
          if (order.remarks && order.remarks !== prevRemarks) {
            const lines = order.remarks.split('\n');
            const newestLine = lines[0] || '';
            const msgContent = newestLine.includes(']:') ? newestLine.substring(newestLine.indexOf(']:') + 2).trim() : newestLine;
            
            const isMentioned = newestLine.includes(`@${currentUName}`) || newestLine.includes(`@${currentRole}`);

            if (isMentioned) {
              shouldNotify = true;
              message = `【有人@你】单号 ${order.id}: ${msgContent}`;
            } else if (!shouldNotify && prevRemarks !== undefined) {
              const currentSales = (order.customer?.['销售'] || '').trim().toLowerCase();
              const myName = (currentUName || '').trim().toLowerCase();
              const isOwnerByField = currentSales && myName && currentSales === myName;
              const isOwnerByUid = order.authorUid === currentU?.uid;
              const isMyOrder = isOwnerByField || isOwnerByUid;

              if (currentRole !== '销售' || isMyOrder || currentRole === 'admin') {
                shouldNotify = true;
                message = `【新留言】单号 ${order.id}: ${msgContent}`;
              }
            }
          }

          if (shouldNotify) {
            addNotification(message, 'info', order._docId);
            try {
              const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3');
              audio.volume = 0.5;
              audio.play();
            } catch (e) { /* ignore sound errors */ }
          }
          
          lastOrdersRef.current[order._docId] = order.status;
          lastRemarksRef.current[order._docId] = order.remarks || '';
        });
      } else {
        filteredOrders.forEach((order: any) => {
          lastOrdersRef.current[order._docId] = order.status;
          lastRemarksRef.current[order._docId] = order.remarks || '';
        });
        isInitialOrdersLoad.current = false;
      }

      setOrders(filteredOrders);

      setViewingOrder(prev => {
        if (!prev) return null;
        const updated = filteredOrders.find(o => o._docId === prev._docId);
        return updated || prev;
      });
    }, (err) => {
      console.error('Failed to listen to orders', err);
      handleFirestoreError(err, OperationType.LIST, 'orders');
      if (err.message && (err.message.includes('Quota') || err.message.includes('quota'))) {
        setQuotaExceeded(true);
      }
      try {
        const cached = localStorage.getItem('cached_orders');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            setOrders(parsed);
          }
        }
      } catch (e) {}
    });

    let unsubscribeUsers = () => {};
    if (userRole === 'admin') {
      const usersQ = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      unsubscribeUsers = onSnapshot(usersQ, (snapshot) => {
        const usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllUsers(usersList);
      }, (err) => {
        console.error('Failed to listen to users', err);
        handleFirestoreError(err, OperationType.LIST, 'users');
        if (err.message && (err.message.includes('Quota') || err.message.includes('quota'))) {
          setQuotaExceeded(true);
        }
      });
    }
    
    return () => {
      unsubscribe();
      unsubscribeUsers();
    };
  }, [authReady, currentUser?.uid, userRole === 'pending', userRole === 'admin']);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [custRes, invRes, priceRes, debtsRes] = await Promise.all([
          fetch('/api/customers'),
          fetch('/api/inventory'),
          fetch('/api/prices'),
          fetch('/api/debts').catch(err => {
            console.error('Failed to fetch debts:', err);
            return null;
          })
        ]);
        
        if (!custRes.ok || !invRes.ok || !priceRes.ok) {
          throw new Error('Failed to fetch data');
        }

        setCustomers(await custRes.json());
        const invResult = await invRes.json();
        setInventory(invResult.data);
        setPrices(await priceRes.json());
        setInventoryUpdateTime(invResult.lastChanged);

        if (debtsRes && debtsRes.ok) {
          try {
            const debtsData = await debtsRes.json();
            setDebts(debtsData || {});
          } catch (dErr) {
            console.error('Error parsing debts JSON:', dErr);
          }
        }
      } catch (err) {
        setErrorMsg('数据加载失败，请刷新页面重试');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const selectedCustomer = useMemo(() => 
    selectedCustomerIndex !== '' ? customers[Number(selectedCustomerIndex)] : undefined,
  [customers, selectedCustomerIndex]);

  const customerLevel = editableCustomer?.['客户级别'] || 'A'; // Default to A if not found

  const availableMaterials = useMemo(() => {
    // Unique materials from prices
    return prices.filter(p => p['物料代码'] && p['物料名称']);
  }, [prices]);

  const visibleOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.status === '已作废') return false;

      // Role-based visibility
      let visibleByRole = false;
      if (userRole === 'admin') {
        visibleByRole = true;
      } else if (userRole === '助销') {
        visibleByRole = o.status !== '草稿';
      } else if (userRole === '销售') {
        const currentSalesName = (o.customer?.['销售'] || '').trim().toLowerCase();
        const myName = (userName || '').trim().toLowerCase();
        const orderSalesperson = (o.salespersonName || '').trim().toLowerCase();
        visibleByRole = (currentSalesName === myName) || (orderSalesperson === myName) || (o.authorUid === currentUser?.uid);
      } else if (userRole === '财务') {
        visibleByRole = ['助销已确认', '财务已确认', '已通知备货', '已叫车', '已发货'].includes(o.status);
      } else if (userRole === '仓管') {
        visibleByRole = ['财务已确认', '已通知备货', '已叫车', '已发货'].includes(o.status);
      } else {
        visibleByRole = o.status !== '草稿'; // Fallback for other roles if any
      }

      return visibleByRole;
    });
  }, [orders, userRole, userName, currentUser]);

  const uniqueSales = useMemo(() => {
    const sales = new Set<string>();
    
    // 1. From visible orders
    visibleOrders.forEach(o => {
      const s = o.customer?.['销售'];
      if (s) sales.add(s.trim());
    });
    
    // 2. From registered platform users with role '销售'
    publicUsers.forEach(u => {
      if (u.role === '销售' && u.username) {
        sales.add(u.username.trim());
      }
    });

    // 3. From customer database
    customers.forEach(c => {
      const s = c['销售'];
      if (s) {
        sales.add(s.trim());
      }
    });
    
    const result = Array.from(sales).filter(Boolean);
    return result.length > 0 ? result.sort() : ['无销售'];
  }, [visibleOrders, publicUsers, customers]);

  const uniqueOrderIds = useMemo(() => {
    const ids = new Set<string>();
    visibleOrders.forEach(o => {
      if (o.id) ids.add(o.id);
    });
    return Array.from(ids).sort();
  }, [visibleOrders]);

  const uniqueCustomerNames = useMemo(() => {
    const names = new Set<string>();
    visibleOrders.forEach(o => {
      const n = o.customer?.['客户名'];
      if (n) names.add(n);
      else names.add('无客户');
    });
    return Array.from(names).sort();
  }, [visibleOrders]);

  const availableSales = useMemo(() => {
    const sales = new Set<string>();
    visibleOrders.forEach(o => {
      const matchOrderId = orderIdFilter.length === 0 || (o.id && orderIdFilter.includes(o.id));
      const matchCustomerName = customerNameFilter.length === 0 || customerNameFilter.includes(o.customer?.['客户名'] || '无客户');
      
      if (matchOrderId && matchCustomerName) {
        const s = o.customer?.['销售'];
        if (s) sales.add(s.trim());
        else sales.add('无销售');
      }
    });
    const result = Array.from(sales).filter(Boolean);
    return result.length > 0 ? result.sort() : ['无销售'];
  }, [visibleOrders, orderIdFilter, customerNameFilter]);

  const availableOrderIds = useMemo(() => {
    const ids = new Set<string>();
    visibleOrders.forEach(o => {
      const matchSales = salesFilter.length === 0 || salesFilter.includes(o.customer?.['销售'] || '无销售');
      const matchCustomerName = customerNameFilter.length === 0 || customerNameFilter.includes(o.customer?.['客户名'] || '无客户');
      
      if (matchSales && matchCustomerName) {
        if (o.id) ids.add(o.id);
      }
    });
    return Array.from(ids).sort();
  }, [visibleOrders, salesFilter, customerNameFilter]);

  const availableCustomerNames = useMemo(() => {
    const names = new Set<string>();
    visibleOrders.forEach(o => {
      const matchSales = salesFilter.length === 0 || salesFilter.includes(o.customer?.['销售'] || '无销售');
      const matchOrderId = orderIdFilter.length === 0 || (o.id && orderIdFilter.includes(o.id));
      
      if (matchSales && matchOrderId) {
        const n = o.customer?.['客户名'];
        if (n) names.add(n);
        else names.add('无客户');
      }
    });
    return Array.from(names).sort();
  }, [visibleOrders, salesFilter, orderIdFilter]);

  const displayedSalesList = useMemo(() => {
    return uniqueSales.filter(s => availableSales.includes(s) || salesFilter.includes(s));
  }, [uniqueSales, availableSales, salesFilter]);

  const displayedOrderIds = useMemo(() => {
    return uniqueOrderIds.filter(id => availableOrderIds.includes(id) || orderIdFilter.includes(id));
  }, [uniqueOrderIds, availableOrderIds, orderIdFilter]);

  const displayedCustomerNames = useMemo(() => {
    return uniqueCustomerNames.filter(name => availableCustomerNames.includes(name) || customerNameFilter.includes(name));
  }, [uniqueCustomerNames, availableCustomerNames, customerNameFilter]);

  const displayedOrders = useMemo(() => {
    return visibleOrders.filter(o => {
      const matchSales = salesFilter.length === 0 || salesFilter.includes(o.customer?.['销售'] || '无销售');
      const matchOrderId = orderIdFilter.length === 0 || (o.id && orderIdFilter.includes(o.id)) || false;
      const matchCustomerName = customerNameFilter.length === 0 || customerNameFilter.includes(o.customer?.['客户名'] || '无客户');
      return matchSales && matchOrderId && matchCustomerName;
    });
  }, [visibleOrders, salesFilter, orderIdFilter, customerNameFilter]);

  const todayConsumption = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const consumption: Record<string, number> = {};

    orders.forEach(order => {
      // Skip voided and draft orders
      if (order.status === '已作废' || order.status === '草稿') return;
      
      // Exclude the current order being edited from consumption calculation
      if (editingOrderId && order._docId === editingOrderId) return;

      // Check if order was created today
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
  }, [orders, editingOrderId]);

  const getRealTimeStockCount = useCallback((code: string, staticStock: number) => {
    const consumed = todayConsumption[code.trim()] || 0;
    return Math.max(0, staticStock - consumed);
  }, [todayConsumption]);

  const filteredMaterials = useMemo(() => {
    return availableMaterials.filter(m => {
      if (selectedCategory === '全部') return true;
      const name = m['物料名称'] || '';
      
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
  }, [availableMaterials, selectedCategory]);

  const getMaterialTotalInventory = useCallback((materialName: string) => {
    return inventory
      .filter(i => i['物料名称']?.trim() === materialName.trim())
      .reduce((sum, i) => {
        const code = (i[' 物料编码 '] || (i as any)['物料编码'] || '').trim();
        const base = Number(i['可用量']) || 0;
        return sum + getRealTimeStockCount(code, base);
      }, 0);
  }, [inventory, getRealTimeStockCount]);

  const handleMaterialItemsChange = useCallback((materialCode: string, items: OrderItem[]) => {
    setDraftOrderItems(prev => ({
      ...prev,
      [materialCode]: items
    }));
  }, []);

  const orderItems = useMemo(() => Object.values(draftOrderItems).flat(), [draftOrderItems]);

  const handleRemoveItem = (id: string, materialCode: string) => {
    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        next[materialCode] = next[materialCode].filter(item => item.id !== id);
        if (next[materialCode].length === 0) {
          delete next[materialCode];
          setSelectedMaterialCodes(codes => codes.filter(c => c !== materialCode));
        }
      }
      return next;
    });
  };

  const groupedOrderItems = useMemo(() => {
    const groups: Record<string, {
      materialCode: string;
      materialName: string;
      totalQuantity: number;
      totalPrice: number;
      unitPrice: number;
      items: OrderItem[];
    }> = {};

    orderItems.forEach(item => {
      if (!groups[item.materialCode]) {
        groups[item.materialCode] = {
          materialCode: item.materialCode,
          materialName: translateProduct(item),
          totalQuantity: 0,
          totalPrice: 0,
          unitPrice: item.unitPrice,
          items: []
        };
      }
      groups[item.materialCode].totalQuantity += item.quantity;
      groups[item.materialCode].totalPrice += item.totalPrice;
      groups[item.materialCode].items.push(item);
    });

    return Object.values(groups);
  }, [orderItems]);

  const toggleMaterialExpanded = (code: string) => {
    setExpandedMaterials(prev => ({ ...prev, [code]: !prev[code] }));
  };

  const handleUpdateItemQuantity = (materialCode: string, itemId: string, newQtyStr: string) => {
    const newQty = parseInt(newQtyStr, 10);
    if (isNaN(newQty) || newQty < 0) return;

    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        next[materialCode] = next[materialCode].map(item => {
          if (item.id === itemId) {
            // Cap at max available
            const priceItem = prices.find(p => p['物料代码'] === materialCode);
            const chineseName = priceItem ? priceItem['物料名称'] : item.materialName;
            const invItem = inventory.find(i => 
              i['物料名称']?.trim() === (chineseName || '').trim() && 
              i['颜色'] === item.color &&
              (item.specification && item.specification !== '-' ? i['规格型号'] === item.specification : true)
            );
            
            let maxQty = Infinity;
            if (invItem) {
              const invCode = (invItem[' 物料编码 '] || (invItem as any)['物料编码'] || '').trim();
              const base = Number(invItem['可用量']) || 0;
              const consumed = todayConsumption[invCode] || 0;
              maxQty = Math.max(0, base - consumed);
            }
            const finalQty = Math.min(newQty, maxQty);

            return {
              ...item,
              quantity: finalQty,
              totalPrice: finalQty * item.unitPrice
            };
          }
          return item;
        });
      }
      return next;
    });
  };

  const handleUpdateItemGroupQuantity = (materialCode: string, newQtyStr: string) => {
    const newQty = parseInt(newQtyStr, 10);
    if (isNaN(newQty) || newQty < 0) return;

    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        const items = [...next[materialCode]];
        if (items.length === 1) {
          const it = { ...items[0] };
          it.quantity = newQty;
          it.totalPrice = newQty * it.unitPrice;
          next[materialCode] = [it];
        } else {
          // Average distribution: spread newQty as evenly as possible across all items in group
          const avgQty = Math.floor(newQty / items.length);
          const remainder = newQty % items.length;
          
          for (let i = 0; i < items.length; i++) {
            const q = avgQty + (i < remainder ? 1 : 0);
            items[i] = { ...items[i], quantity: q, totalPrice: q * items[i].unitPrice };
          }
          next[materialCode] = items;
        }
      }
      return next;
    });
  };

  const handleUpdateItemPrice = (materialCode: string, newPriceStr: string) => {
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice < 0) return;

    setDraftOrderItems(prev => {
      const next = { ...prev };
      if (next[materialCode]) {
        next[materialCode] = next[materialCode].map(item => ({
          ...item,
          unitPrice: newPrice,
          totalPrice: item.quantity * newPrice
        }));
      }
      return next;
    });
  };

  const orderTotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);

  useEffect(() => {
    if (currentStep === 4 && !isOrderIdEdited) {
      setGeneratedOrderId('new order');
    }
  }, [currentStep, isOrderIdEdited]);

  const handleSaveOrder = async (isDraft: boolean = false, bypassInventoryCheck: boolean = false) => {
    if (!currentUser) {
      setErrorMsg('请先登录');
      return;
    }
    if (!editableCustomer) {
      setErrorMsg('请选择客户');
      return;
    }
    if (orderItems.length === 0) {
      setErrorMsg('订单不能为空');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      // Inventory check before submitting as a live order
      if (!isDraft && !bypassInventoryCheck) {
        const insufficientItems: { name: string; color: string; spec: string; requested: number; available: number }[] = [];
        
        orderItems.forEach((item: any) => {
          const priceItem = prices.find(p => p['物料代码'] === item.materialCode);
          const chineseName = priceItem ? priceItem['物料名称'] : item.materialName;
          
          const invItem = inventory.find(i => 
            i['物料名称']?.trim() === (chineseName || '').trim() && 
            i['颜色'] === item.color &&
            (item.specification && item.specification !== '-' ? i['规格型号'] === item.specification : true)
          );
          
          if (invItem) {
            const invCode = (invItem[' 物料编码 '] || (invItem as any)['物料编码'] || '').trim();
            const base = Number(invItem['可用量']) || 0;
            const consumed = todayConsumption[invCode] || 0;
            const availableStock = Math.max(0, base - consumed);
            
            if (item.quantity > availableStock) {
              insufficientItems.push({
                name: chineseName || item.materialName,
                color: item.color,
                spec: item.specification || '-',
                requested: item.quantity,
                available: availableStock
              });
            }
          }
        });

        if (insufficientItems.length > 0) {
          setInventoryWarningItems(insufficientItems);
          setSaving(false);
          return;
        }
      }

      let finalRemarks = orderRemarks.trim();
      
      const now = new Date();
      const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const displayName = userName || currentUser?.email?.split('@')[0] || 'Unknown';

      if (!editingOrderId && finalRemarks) {
        finalRemarks = `[${timestamp} ${displayName}]: ${finalRemarks}`;
      } else if (editingOrderId) {
        // Log modification with item diff
        let diffDetail = "";
        try {
          const oldDoc = await getDoc(doc(db, 'orders', editingOrderId));
          if (oldDoc.exists()) {
            const oldData = oldDoc.data();
            const oldItems = oldData.items || [];
            
            const oldMap = new Map();
            oldItems.forEach((it: any) => {
              const k = it.materialCode;
              oldMap.set(k, (oldMap.get(k) || 0) + it.quantity);
            });
            
            const newMap = new Map();
            orderItems.forEach((it: any) => {
              const k = it.materialCode;
              newMap.set(k, (newMap.get(k) || 0) + it.quantity);
            });
            
            const changes: string[] = [];
            // Added or changed totals
            newMap.forEach((qty, code) => {
              const oldQty = oldMap.get(code);
              if (oldQty === undefined) {
                changes.push(`ADD:${code}:${qty}`);
              } else if (oldQty !== qty) {
                changes.push(`CHG:${code}:${oldQty}:${qty}`);
              }
            });
            // Removed
            oldMap.forEach((qty, code) => {
              if (!newMap.has(code)) {
                changes.push(`REM:${code}:${qty}`);
              }
            });
            
            if (changes.length > 0) {
              diffDetail = ` 修改了内容: 【${changes.join(', ')}】`;
            } else {
              diffDetail = ` 修改了订单属性`;
            }
          }
        } catch (e) {
          console.error("Error diffing items", e);
          diffDetail = " 修改了订单内容";
        }

        const logEntry = isFrench 
          ? `[Log Système ${timestamp} ${displayName}]:${diffDetail}`
          : `[系统日志 ${timestamp} ${displayName}]:${diffDetail}`;
        finalRemarks = finalRemarks ? `${logEntry}\n${finalRemarks}` : logEntry;
      }

      const sanitizeForFirestore = (obj: any): any => {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
          return obj.map(item => sanitizeForFirestore(item));
        }
        // Retain Firestore FieldValue / serverTimestamp
        if (typeof obj === 'object' && (obj._methodName || (obj.constructor && obj.constructor.name === 'FieldValue'))) return obj;
        const cleanObj: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
          const trimmedKey = typeof key === 'string' ? key.trim() : String(key);
          // Firestore does not allow empty keys or keys that are purely whitespace
          if (!trimmedKey) continue;
          if (value !== undefined) {
            cleanObj[trimmedKey] = sanitizeForFirestore(value);
          } else {
            cleanObj[trimmedKey] = '';
          }
        }
        return cleanObj;
      };

      const finalCustomer = editableCustomer ? {
        ...editableCustomer,
        '备注': editableCustomer['备注'] || ''
      } : {};

      const sanitizedCustomer = sanitizeForFirestore(finalCustomer);
      const sanitizedItems = sanitizeForFirestore(orderItems);

      const safeOrderId = (generatedOrderId && generatedOrderId.trim()) ? generatedOrderId.trim() : 'new order';
      const safeTotalAmount = isNaN(orderTotal) ? 0 : Number(orderTotal);

      const orderData: any = {
        id: safeOrderId,
        customer: sanitizedCustomer || {},
        items: Array.isArray(sanitizedItems) ? sanitizedItems : [],
        totalAmount: safeTotalAmount,
        status: isDraft ? '草稿' : '新建',
        isPriority: false,
        remarks: finalRemarks || '',
        updatedAt: serverTimestamp(),
        authorUid: currentUser.uid,
        salespersonName: userName || ''
      };

      if (editingOrderId) {
        await updateDoc(doc(db, 'orders', editingOrderId), orderData);
        setSuccessMsg('订单更新成功！');
      } else {
        orderData.createdAt = serverTimestamp();
        await addDoc(collection(db, 'orders'), orderData);
        setSuccessMsg('订单保存成功！');
      }

      // Asynchronously trigger Telegram / WeChat personalized notifications on creation or updates
      try {
        const notifyTitle = editingOrderId ? '订单内容已修改' : (isDraft ? '新草稿订单已保存' : '新订单已创建');
        const notifyBody = `*订单单号*: ${safeOrderId}\n*当前状态*: ${isDraft ? '草稿' : '新建'}\n*客户名*: ${finalCustomer?.['客户名'] || '-'}\n*估算总额*: CFA ${safeTotalAmount.toFixed(0)}\n*操作人员*: ${displayName}`;
        
        const targets: { usernames: string[], roles: string[] } = { usernames: [], roles: [] };
        if (!isDraft) {
          targets.roles.push('助销'); // New orders notify assist sales
        }
        const salesName = (finalCustomer?.['销售'] || '').trim();
        if (salesName) {
          targets.usernames.push(salesName); // Also notify salesperson
        }

        triggerNotification({
          title: notifyTitle,
          body: notifyBody,
          targetUsernames: targets.usernames,
          targetRoles: targets.roles
        });
      } catch (err) {
        console.error('Telegram order save notification failed', err);
      }

      resetForm();
      setCurrentView('list');
      
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Save order error:', err);
      const errMsg = err?.message || (typeof err === 'string' ? err : '未知错误');
      setErrorMsg(isFrench ? `Erreur lors de l'enregistrement: ${errMsg}` : `保存订单时发生错误: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOrderId = async () => {
    if (!viewingOrder || !viewingOrder._docId || !orderIdInput.trim()) return;
    try {
      const orderRef = doc(db, 'orders', viewingOrder._docId);
      await updateDoc(orderRef, { id: orderIdInput.trim() });
      setViewingOrder({ ...viewingOrder, id: orderIdInput.trim() });
      setIsEditingOrderId(false);
    } catch (err) {
      console.error('Failed to update order ID', err);
      alert('更新订单号失败，请重试');
    }
  };

  const handleSaveRemarks = async () => {
    if (!viewingOrder || !viewingOrder._docId || !remarksInput.trim()) {
      setIsEditingRemarks(false);
      return;
    }
    try {
      const orderRef = doc(db, 'orders', viewingOrder._docId);
      const now = new Date();
      const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const displayName = userName || currentUser?.email?.split('@')[0] || 'Unknown';
      
      const newMessage = `[${timestamp} ${displayName}]: ${remarksInput.trim()}`;
      const updatedRemarks = viewingOrder.remarks 
        ? `${newMessage}\n${viewingOrder.remarks}`
        : newMessage;

      await updateDoc(orderRef, { remarks: updatedRemarks });
      setViewingOrder({ ...viewingOrder, remarks: updatedRemarks });
      
      // Asynchronously trigger Telegram notification for remarks / mentions
      try {
        const commentText = remarksInput.trim();
        const mentionRegex = /@(\S+)/g;
        const mentionedUsernames: string[] = [];
        let match;
        while ((match = mentionRegex.exec(commentText)) !== null) {
          mentionedUsernames.push(match[1]);
        }

        let notifyTitle = '订单新增留言';
        let targetUsernames: string[] = [];
        let targetRoles: string[] = [];

        if (mentionedUsernames.length > 0) {
          notifyTitle = '有人在订单中提及了你 (@)';
          targetUsernames = mentionedUsernames;
        } else {
          // Default: send to the salesperson associated with the order
          const salesName = (viewingOrder.customer?.['销售'] || '').trim();
          if (salesName) {
            targetUsernames.push(salesName);
          }
        }

        const notifyBody = `*订单单号*: ${viewingOrder.id}\n*留言内容*: ${commentText}\n*发言人*: ${displayName}\n*时间*: ${timestamp}`;
        triggerNotification({
          title: notifyTitle,
          body: notifyBody,
          targetUsernames,
          targetRoles
        });
      } catch (errNotify) {
        console.error('Telegram comment remark notification failed:', errNotify);
      }

      setRemarksInput('');
      setIsEditingRemarks(false);
    } catch (err) {
      console.error('Failed to update remarks', err);
      alert('更新备注失败，请重试');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const cleanUsername = loginUsername.trim();
    const email = `${cleanUsername}@sheetorder.local`;

    try {
      // 1. Try querying Firestore for user details, but handle quota/network errors gracefully
      let userDocData: any = null;
      let isFirestoreBlocked = false;

      try {
        const q = query(collection(db, 'users'), where('username', '==', cleanUsername));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          userDocData = querySnap.docs[0].data();
        }
      } catch (fErr: any) {
        console.warn('Firestore query failed during login (falling back to Auth directly):', fErr);
        isFirestoreBlocked = true;
        if (fErr.message && (fErr.message.includes('Quota') || fErr.message.includes('quota'))) {
          setQuotaExceeded(true);
        }
      }

      // Check maintenance block
      const isLoggingInAsAdmin = cleanUsername === 'admin' || cleanUsername === 'admin123' || (userDocData && userDocData.role === 'admin');
      if (maintenanceMode && !isLoggingInAsAdmin) {
        setLoginError(' é̙͍͇̕ç͠_̭̖d̲̱_̝̀p͕̱_̧d̗̹v̸̰_̶̮m̝̣_̷͓x̗͟9龘爨灪 [SYSTEM_MAINTENANCE_ERROR_503_ILLEGAL_ACCESS_DENIED_0x80244007]');
        return;
      }

      // Special check for bootstrap admin if it doesn't exist in Firestore yet
      if (!userDocData && !isFirestoreBlocked && (
        (cleanUsername === 'admin' && loginPassword === 'admin123') ||
        (cleanUsername === 'admin123' && loginPassword === 'admin123')
      )) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, "SheetOrderAuthSecurePassword789!");
          try {
            await setDoc(doc(db, 'users', cred.user.uid), {
              username: cleanUsername,
              role: 'admin',
              password: 'admin123',
              createdAt: serverTimestamp()
            });
          } catch (e) {}
          return;
        } catch (createErr: any) {
          if (createErr.code === 'auth/email-already-in-use') {
            await signInWithEmailAndPassword(auth, email, "SheetOrderAuthSecurePassword789!");
            return;
          }
        }
      }

      // If userDocData was retrieved and has a password stored, verify password against Firestore record
      if (userDocData && userDocData.password && userDocData.password !== loginPassword) {
        setLoginError('用户名或密码错误');
        return;
      }

      // If Firestore query succeeded and returned no user at all, reject
      if (!isFirestoreBlocked && !userDocData && cleanUsername !== 'admin' && cleanUsername !== 'admin123') {
        setLoginError('用户名或密码错误');
        return;
      }

      // Authenticate via Firebase Auth
      try {
        // Try standard constant password first (ideal case)
        await signInWithEmailAndPassword(auth, email, "SheetOrderAuthSecurePassword789!");
      } catch (authErr: any) {
        if (authErr.code === 'auth/invalid-credential' || authErr.code === 'auth/wrong-password') {
          // If custom password was used during creation
          await signInWithEmailAndPassword(auth, email, loginPassword);
          if (auth.currentUser) {
            try {
              await updatePassword(auth.currentUser, "SheetOrderAuthSecurePassword789!");
            } catch (pErr) {}
          }
        } else if (authErr.code === 'auth/user-not-found') {
          setLoginError('用户名或密码错误');
          return;
        } else {
          throw authErr;
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setLoginError('请在 Firebase 控制台启用 "电子邮件/密码" 登录方式！');
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setLoginError('用户名或密码错误');
      } else if (err.message && (err.message.includes('Quota') || err.message.includes('quota'))) {
        setQuotaExceeded(true);
        setLoginError('数据库配额超限，请点击上方提示升级配额或稍后再试。');
      } else {
        setLoginError('登录失败: ' + err.message);
      }
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const apiKey = auth.app.options.apiKey;
      const email = `${newUsername}@sheetorder.local`;
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: "SheetOrderAuthSecurePassword789!", returnSecureToken: false })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error.message === 'EMAIL_EXISTS') throw new Error('用户名已存在');
        if (data.error.message === 'OPERATION_NOT_ALLOWED') throw new Error('请在 Firebase 控制台启用"电子邮件/密码"登录方式');
        throw new Error(data.error.message);
      }

      await setDoc(doc(db, 'users', data.localId), {
        username: newUsername,
        role: newRole,
        password: newPassword, // Store custom admin-set password
        createdAt: serverTimestamp()
      });

      setNewUsername('');
      setNewPassword('');
      alert('账号创建成功！');
    } catch (err: any) {
      alert('创建失败: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !currentUser.email) return;
    try {
      // Re-authenticate first to ensure no 'auth/requires-recent-login' error
      const credential = EmailAuthProvider.credential(currentUser.email, oldSelfPassword);
      await reauthenticateWithCredential(currentUser, credential);

      await updatePassword(currentUser, newSelfPassword);
      // Attempt to update the stored password reference for the admin (might fail depending on rules, but worth trying)
      try {
        await updateDoc(doc(db, 'users', currentUser.uid), { password: newSelfPassword });
      } catch (e) {
        // Ignore firestore permission errors if user cannot update their own doc
      }
      setPasswordMessage({ type: 'success', text: '密码修改成功！' });
      setOldSelfPassword('');
      setNewSelfPassword('');
      setTimeout(() => {
        setIsChangingPassword(false);
        setPasswordMessage({ type: '', text: '' });
      }, 5000);
    } catch (err: any) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordMessage({ type: 'error', text: '原密码错误，请重试。' });
      } else {
        setPasswordMessage({ type: 'error', text: '修改失败: ' + err.message });
      }
    }
  };

  if (loading || !authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{backgroundColor: 'var(--bg)'}}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{borderColor: 'var(--primary)'}}></div>
      </div>
    );
  }

  if (!currentUser) {
    const rolesOrder = ['admin', '销售', '财务', '助销', '仓管', 'pending'];
    const roles = Array.from(new Set(publicUsers.map(u => u.role))).filter(Boolean).sort((a, b) => {
      const idxA = rolesOrder.indexOf(a as string);
      const idxB = rolesOrder.indexOf(b as string);
      return (idxA > -1 ? idxA : 99) - (idxB > -1 ? idxB : 99);
    });

    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative py-12 px-4" style={{backgroundColor: 'var(--bg)'}}>
        <div className="absolute top-4 right-4 flex gap-2">
          <button type="button" onClick={() => setLoginLanguage('zh')} className={`px-3 py-1 text-xs rounded border transition-colors ${loginLanguage === 'zh' ? 'bg-blue-100 border-blue-200 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>中文</button>
          <button type="button" onClick={() => setLoginLanguage('fr')} className={`px-3 py-1 text-xs rounded border transition-colors ${loginLanguage === 'fr' ? 'bg-blue-100 border-blue-200 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>Français</button>
        </div>
        
        {quotaExceeded && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 shadow-sm max-w-md w-full">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-amber-900">
                  {t('Firestore 免费配额已达今日上限', 'Limite de quota Firestore atteinte')}
                </h4>
                <p className="text-xs text-amber-700 mt-1">
                  {t(
                    '免费读取配额每日自动重置。您仍可正常输入账号密码登录系统查看本地缓存数据。',
                    'Le quota journalier sera réinitialisé demain. Vous pouvez toujours vous connecter.'
                  )}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <a
                    href="https://console.firebase.google.com/project/gen-lang-client-0012197131/firestore/databases/ai-studio-b9d2a28b-82a4-491f-9a85-2aedbcec7a1e/data?openUpgradeDialog=true"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 underline"
                  >
                    <span>{t('管理数据库 / 升级配额', 'Consulter la console / Mettre à niveau')}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full relative mt-4">
          <ShoppingCart className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">TTP order management</h1>
          <p className="text-gray-500 mb-6">{t('请输入您的账号密码登录', 'Veuillez entrer votre compte et mot de passe pour vous connecter')}</p>
          
          <form onSubmit={handleLogin} className="space-y-4 text-left">
            {loginError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}
            
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-700">{t('用户名', 'Nom d\'utilisateur')}</label>
                <button 
                  type="button" 
                  onClick={() => setIsManualLogin(!isManualLogin)} 
                  className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  {isManualLogin ? t('返回选择', 'Retour au choix') : t('手工输入', 'Saisie manuelle')}
                </button>
              </div>
              
              {isManualLogin || publicUsers.length === 0 ? (
                <input 
                  type="text" 
                  required 
                  className="theme-input w-full" 
                  value={loginUsername} 
                  onChange={e => setLoginUsername(e.target.value)}
                  placeholder={t('请输入用户名', 'Entrez votre nom d\'utilisateur')}
                />
              ) : (
                <div className="relative">
                  <select
                    required
                    className="theme-select w-full appearance-none pr-8"
                    value={loginUsername}
                    onChange={e => setLoginUsername(e.target.value)}
                  >
                    <option value="" disabled>{t('请选择您的账号...', 'Sélectionnez votre compte...')}</option>
                    {publicUsers.filter(u => u.role !== 'admin').map(u => (
                      <option key={u.username} value={u.username}>{u.username}</option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('密码', 'Mot de passe')}</label>
              <input 
                type="password" 
                required 
                className="theme-input w-full" 
                value={loginPassword} 
                onChange={e => setLoginPassword(e.target.value)}
                placeholder={t('请输入密码', 'Entrez votre mot de passe')}
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors mt-2"
            >
              {t('登录系统', 'Se connecter')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (userRole === 'pending') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{backgroundColor: 'var(--bg)'}}>
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full">
          <Shield className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('等待审核', 'En attente de validation')}</h1>
          <p className="text-gray-500 mb-8">{t('您的账号已注册成功，请等待管理员分配角色权限。', 'Votre compte a été créé avec succès. Veuillez attendre que l\'administrateur vous attribue un rôle.')}</p>
          <button 
            onClick={handleLogout}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-5 h-5" />
            {t('退出登录', 'Se déconnecter')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="app-header print:hidden">
        <div className="logo cursor-pointer" onClick={() => setCurrentView('list')}>
          <ShoppingCart className="w-6 h-6" />
          <span className="truncate">TTP order management</span>
        </div>
        <div className="header-actions flex items-center gap-4 w-full sm:w-auto">
          <div className="tabs-container">
            <div className="flex bg-gray-100 p-1 rounded-lg w-max sm:w-auto">
              <button 
                onClick={() => setCurrentView('list')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap ${currentView === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <List className="w-4 h-4" />
                {t('订单', 'Ordre')}
              </button>
              {(userRole === 'admin' || userRole === '销售' || userRole === '助销') && (
                <button 
                  onClick={() => {
                    resetForm();
                    setCurrentView('create');
                  }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap ${currentView === 'create' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  <Plus className="w-4 h-4" />
                  {t('新建', 'Nouveau')}
                </button>
              )}
              {userRole === 'admin' && (
                <button 
                  onClick={() => setCurrentView('users')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap ${currentView === 'users' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  <Users className="w-4 h-4" />
                  {t('账号', 'Comptes')}
                </button>
              )}
            </div>
          </div>
          <div className="header-tools border-l-0 sm:border-l sm:pl-4 border-gray-200">
            <button
              onClick={requestNotificationPermission}
              className={`p-2 rounded-lg transition-all ${
                browserNotificationGranted 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
              }`}
            >
              {browserNotificationGranted ? <Bell className="w-4 h-4 sm:w-5 sm:h-5 fill-current" /> : <BellOff className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
            <div className="flex items-center gap-2">
              {currentUser.photoURL ? (
                <img src={currentUser.photoURL} alt="Avatar" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm">
                  {currentUser.email?.[0].toUpperCase()}
                </div>
              )}
              <div className="hidden md:block text-sm">
                <div className="font-medium text-gray-700 leading-tight truncate">{currentUser.email?.split('@')[0]}</div>
                <div className="text-xs text-blue-600 font-medium">{userRole}</div>
              </div>
            </div>
            
            <button 
              onClick={() => setIsChangingPassword(true)} 
              className="text-gray-500 hover:text-blue-600 transition-colors ml-2" 
              title={t('修改密码', 'Changer le mot de passe')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-key-round w-4 h-4 sm:w-5 sm:h-5"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>
            </button>

            <button 
              onClick={() => setLoginLanguage(isFrench ? 'zh' : 'fr')}
              className="ml-2 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs font-bold text-gray-600 transition-colors"
              title={isFrench ? "Passer en chinois" : "Passer en français"}
            >
              {isFrench ? 'CN' : 'FR'}
            </button>

            <button onClick={handleLogout} className="text-gray-500 hover:text-red-500 transition-colors ml-2" title={t('退出登录', 'Se déconnecter')}>
              <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 flex justify-around items-center z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setCurrentView('list')}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'list' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <List className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase">{t('订单', 'Ordre')}</span>
        </button>
        {(userRole === 'admin' || userRole === '销售' || userRole === '助销') && (
          <button 
            onClick={() => {
              resetForm();
              setCurrentView('create');
            }}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'create' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Plus className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase">{t('新建', 'Nouveau')}</span>
          </button>
        )}
        {userRole === 'admin' && (
          <button 
            onClick={() => setCurrentView('users')}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentView === 'users' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase">{t('账号', 'Comptes')}</span>
          </button>
        )}
        <button 
          onClick={handleLogout}
          className="flex flex-col items-center gap-1 p-2 text-gray-500"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase">{t('退出', 'Sortie')}</span>
        </button>
      </nav>

      <main className="main-layout print:p-0 print:block">
        {quotaExceeded && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm text-amber-900">
                    {t('Firestore 免费配额已达今日上限 (Free Tier Quota Exceeded)', 'Limite de quota journalier gratuit Firestore atteinte')}
                  </h4>
                  <p className="text-xs text-amber-700 mt-1">
                    {t(
                      '数据库读取配额将于次日（太平洋时间午夜）自动重置。系统已自动载入本地缓存数据以保障您的离线浏览与制单。如需永久解除配额限制，可在 Firebase 控制台开启结算/升级数据库。',
                      'Le quota de lecture gratuit sera réinitialisé demain. Les données locales en cache sont utilisées pour préserver l\'accès.'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end md:self-auto flex-shrink-0">
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0012197131/firestore/databases/ai-studio-b9d2a28b-82a4-491f-9a85-2aedbcec7a1e/data?openUpgradeDialog=true"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <span>{t('管理数据库 / 升级配额', 'Consulter la console / Mettre à niveau')}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => setQuotaExceeded(false)}
                  className="text-amber-500 hover:text-amber-800 p-1.5 rounded-lg hover:bg-amber-100/60 transition-colors"
                  title="关闭提示"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
        
        {currentView === 'list' && (
          <div className="w-full max-w-7xl">
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800">{t('所有订单', 'Toutes les Commandes')} ({displayedOrders.length})</h2>
                {(userRole === 'admin' || userRole === '销售' || userRole === '助销') && (
                  <button 
                    onClick={() => {
                      resetForm();
                      setCurrentView('create');
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {t('新建订单', 'Nouvelle Commande')}
                  </button>
                )}
              </div>
              
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-end">
                {/* 订单号多选 */}
                <div className="flex-1 relative">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('订单号', 'N° de Commande')}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOrderIdFilterOpen(!isOrderIdFilterOpen);
                      setIsCustomerFilterOpen(false);
                      setIsSalesFilterOpen(false);
                    }}
                    className="w-full text-sm py-2 px-3 text-left bg-white border border-gray-300 rounded-lg flex justify-between items-center hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100"
                  >
                    <span className="truncate text-gray-700 font-medium">
                      {orderIdFilter.length === 0 
                        ? t('全部 (多选)', 'Tout (Sélection multiple)') 
                        : `${t('已选', 'Sélectionné')} (${orderIdFilter.length})`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOrderIdFilterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isOrderIdFilterOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => {
                        setIsOrderIdFilterOpen(false);
                        setOrderIdSearch('');
                      }} />
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto flex flex-col p-2 min-w-[200px]">
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-250 rounded-lg p-2 mb-2 outline-none focus:border-blue-500"
                          placeholder={`${t('搜索订单号', 'Rechercher N°...')}...`}
                          value={orderIdSearch}
                          onChange={(e) => setOrderIdSearch(e.target.value)}
                        />
                        <div className="flex justify-between gap-2 mb-2 px-1 pb-2 border-b border-gray-100 text-xs">
                          <button
                            type="button"
                            onClick={() => setOrderIdFilter([])}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('重置全部', 'Tout Réinitialiser')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const matches = displayedOrderIds.filter(id => id.toLowerCase().includes(orderIdSearch.toLowerCase()));
                              setOrderIdFilter(prev => Array.from(new Set([...prev, ...matches])));
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('全选当前', 'Tout cocher')}
                          </button>
                        </div>
                        <div className="overflow-y-auto max-h-48 divide-y divide-gray-50">
                          {displayedOrderIds
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
                                    className="rounded border-gray-300 text-blue-650 focus:ring-blue-500 w-3.5 h-3.5"
                                  />
                                  <span className="text-gray-755 font-mono">{id}</span>
                                </label>
                              );
                            })}
                          {displayedOrderIds.filter(id => id.toLowerCase().includes(orderIdSearch.toLowerCase())).length === 0 && (
                            <div className="text-center py-4 text-xs text-gray-400">
                              {t('无匹配数据', 'Aucune donnée')}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 客户名称多选 */}
                <div className="flex-1 relative">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('客户名称', 'Nom du Client')}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomerFilterOpen(!isCustomerFilterOpen);
                      setIsOrderIdFilterOpen(false);
                      setIsSalesFilterOpen(false);
                    }}
                    className="w-full text-sm py-2 px-3 text-left bg-white border border-gray-300 rounded-lg flex justify-between items-center hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100"
                  >
                    <span className="truncate text-gray-700 font-medium">
                      {customerNameFilter.length === 0 
                        ? t('全部 (多选)', 'Tout (Sélection multiple)') 
                        : `${t('已选', 'Sélectionné')} (${customerNameFilter.length})`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isCustomerFilterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isCustomerFilterOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => {
                        setIsCustomerFilterOpen(false);
                        setCustomerSearch('');
                      }} />
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto flex flex-col p-2 min-w-[200px]">
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-250 rounded-lg p-2 mb-2 outline-none focus:border-blue-500"
                          placeholder={`${t('搜索客户名称', 'Rechercher client...')}...`}
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                        />
                        <div className="flex justify-between gap-2 mb-2 px-1 pb-2 border-b border-gray-100 text-xs">
                          <button
                            type="button"
                            onClick={() => setCustomerNameFilter([])}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('重置全部', 'Tout Réinitialiser')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const matches = displayedCustomerNames.filter(name => name.toLowerCase().includes(customerSearch.toLowerCase()));
                              setCustomerNameFilter(prev => Array.from(new Set([...prev, ...matches])));
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('全选当前', 'Tout cocher')}
                          </button>
                        </div>
                        <div className="overflow-y-auto max-h-48 divide-y divide-gray-50">
                          {displayedCustomerNames
                            .filter(name => name.toLowerCase().includes(customerSearch.toLowerCase()))
                            .map(name => {
                              const isChecked = customerNameFilter.includes(name);
                              return (
                                <label key={name} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs rounded select-none">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setCustomerNameFilter(customerNameFilter.filter(x => x !== name));
                                      } else {
                                        setCustomerNameFilter([...customerNameFilter, name]);
                                      }
                                    }}
                                    className="rounded border-gray-300 text-blue-650 focus:ring-blue-500 w-3.5 h-3.5"
                                  />
                                  <span className="text-gray-700">{name}</span>
                                </label>
                              );
                            })}
                          {displayedCustomerNames.filter(name => name.toLowerCase().includes(customerSearch.toLowerCase())).length === 0 && (
                            <div className="text-center py-4 text-xs text-gray-400">
                              {t('无匹配数据', 'Aucune donnée')}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 销售人员多选 */}
                <div className="flex-1 relative">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('销售人员', 'Commercial')}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSalesFilterOpen(!isSalesFilterOpen);
                      setIsOrderIdFilterOpen(false);
                      setIsCustomerFilterOpen(false);
                    }}
                    className="w-full text-sm py-2 px-3 text-left bg-white border border-gray-300 rounded-lg flex justify-between items-center hover:border-blue-500 transition-colors focus:ring-2 focus:ring-blue-100"
                  >
                    <span className="truncate text-gray-700 font-medium">
                      {salesFilter.length === 0 
                        ? t('全部 (多选)', 'Tout (Sélection multiple)') 
                        : `${t('已选', 'Sélectionné')} (${salesFilter.length})`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isSalesFilterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isSalesFilterOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => {
                        setIsSalesFilterOpen(false);
                        setSalesSearch('');
                      }} />
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto flex flex-col p-2 min-w-[200px]">
                        <input
                          type="text"
                          className="w-full text-xs border border-gray-255 rounded-lg p-2 mb-2 outline-none focus:border-blue-500"
                          placeholder={`${t('搜索销售人员', 'Rechercher commercial...')}...`}
                          value={salesSearch}
                          onChange={(e) => setSalesSearch(e.target.value)}
                        />
                        <div className="flex justify-between gap-2 mb-2 px-1 pb-2 border-b border-gray-100 text-xs">
                          <button
                            type="button"
                            onClick={() => setSalesFilter([])}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('重置全部', 'Tout Réinitialiser')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const matches = displayedSalesList.filter(s => s.toLowerCase().includes(salesSearch.toLowerCase()));
                              setSalesFilter(prev => Array.from(new Set([...prev, ...matches])));
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {t('全选当前', 'Tout cocher')}
                          </button>
                        </div>
                        <div className="overflow-y-auto max-h-48 divide-y divide-gray-50">
                          {displayedSalesList
                            .filter(s => s.toLowerCase().includes(salesSearch.toLowerCase()))
                            .map(s => {
                              const isChecked = salesFilter.includes(s);
                              return (
                                <label key={s} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs rounded select-none">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setSalesFilter(salesFilter.filter(x => x !== s));
                                      } else {
                                        setSalesFilter([...salesFilter, s]);
                                      }
                                    }}
                                    className="rounded border-gray-300 text-blue-650 focus:ring-blue-500 w-3.5 h-3.5"
                                  />
                                  <span className="text-gray-700">{s}</span>
                                </label>
                              );
                            })}
                          {displayedSalesList.filter(s => s.toLowerCase().includes(salesSearch.toLowerCase())).length === 0 && (
                            <div className="text-center py-4 text-xs text-gray-400">
                              {t('无匹配数据', 'Aucune donnée')}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">暂无订单</h3>
                <p className="text-gray-500">点击右上角按钮创建您的第一个订单</p>
              </div>
            ) : (
              <div className="bg-white sm:rounded-xl sm:border border-gray-200 overflow-hidden sm:shadow-sm">
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="px-6 py-4 font-medium">{t('订单号', 'N° Commande')}</th>
                        <th className="px-6 py-4 font-medium">{t('销售', 'Commercial')}</th>
                        <th className="px-6 py-4 font-medium">{t('客户名称', 'Nom du Client')}</th>
                        {userRole !== '仓管' && <th className="px-6 py-4 font-medium">{t('金额', 'Montant')}</th>}
                        <th className="px-6 py-4 font-medium">{t('状态', 'Statut')}</th>
                        <th className="px-6 py-4 font-medium">{t('优先', 'Priorité')}</th>
                        <th className="px-6 py-4 font-medium">{t('日期', 'Date')}</th>
                        <th className="px-6 py-4 font-medium text-right">{t('操作', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {displayedOrders.map((order) => {
                        let rowClass = "hover:bg-gray-50 transition-colors";
                        const status = order.status;

                        if (userRole === '助销') {
                          if (status === '新建') rowClass = "bg-red-200 hover:bg-red-300 transition-colors";
                          else rowClass = "bg-green-200 hover:bg-green-300 transition-colors";
                        } else if (userRole === '财务') {
                          if (status === '助销已确认') rowClass = "bg-red-200 hover:bg-red-300 transition-colors";
                          else if (['财务已确认', '已通知备货', '已叫车', '已发货'].includes(status)) rowClass = "bg-green-200 hover:bg-green-300 transition-colors";
                        } else if (userRole === '仓管') {
                          if (['财务已确认', '已通知备货', '已叫车'].includes(status)) rowClass = "bg-red-200 hover:bg-red-300 transition-colors";
                          else if (status === '已发货') rowClass = "bg-green-200 hover:bg-green-300 transition-colors";
                        } else if (userRole === '销售' || userRole === 'admin') {
                          if (status === '已发货') rowClass = "bg-green-200 hover:bg-green-300 transition-colors";
                        }

                        return (
                          <tr key={order._docId} className={rowClass}>
                          <td 
                            className="px-6 py-4 font-medium text-blue-600 cursor-pointer hover:underline"
                            onClick={() => {
                              setViewingOrder(order);
                              setCurrentView('detail');
                            }}
                          >
                            {order.id}
                          </td>
                          <td className="px-6 py-4 text-gray-600">
                            {order.customer?.['销售'] || '无销售'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{order.customer?.['客户名']}</div>
                          </td>
                          {userRole !== '仓管' && (
                            <td className="px-6 py-4 font-medium text-gray-900">
                              {order.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </td>
                          )}
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              order.status === '草稿' 
                                ? 'bg-gray-100 text-gray-700 border border-gray-200' 
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {translateStatus(order.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input 
                                type="checkbox" 
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                checked={order.isPriority || false} 
                                onChange={() => handleTogglePriority(order._docId, order.isPriority || false)} 
                                disabled={userRole !== '销售' && userRole !== 'admin' && userRole !== '助销'} 
                              />
                              {order.isPriority && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                            </label>
                          </td>
                          <td className="px-6 py-4 text-gray-500">
                            {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : new Date().toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {userRole === '助销' && order.status === '新建' && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleUpdateOrderStatus(order._docId, '助销已确认'); }}
                                className="text-purple-600 hover:text-purple-800 mr-3 font-medium"
                              >
                                {t('确认', 'Confirmer')}
                              </button>
                            )}
                            {userRole === '财务' && order.status === '助销已确认' && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleUpdateOrderStatus(order._docId, '财务已确认'); }}
                                className="text-green-600 hover:text-green-800 mr-3 font-medium"
                              >
                                {t('财务确认', 'Compta Confirmer')}
                              </button>
                            )}

                            {(userRole === 'admin' || userRole === '助销' || order.authorUid === currentUser?.uid || userName?.trim() === order.customer?.['销售']?.trim() || userName?.trim() === order.salespersonName?.trim()) && (
                              <>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleEditOrder(order); }}
                                  className="text-blue-600 hover:text-blue-800 mr-3 font-medium"
                                >
                                  {t('修改', 'Modifier')}
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setIsHardDelete(false); setDeleteConfirmId(order._docId); }}
                                  className="text-red-600 hover:text-red-800 font-medium px-2 py-1 bg-red-50 rounded"
                                >
                                  {t('作废', 'Annuler')}
                                </button>
                              </>
                            )}
                            {userRole === 'admin' && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); setIsHardDelete(true); setDeleteConfirmId(order._docId); }}
                                className="text-red-700 hover:text-red-900 font-bold ml-3"
                              >
                                {t('彻底删除', 'Supprimer Définitivement')}
                              </button>
                            )}
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
                    let cardClass = "bg-white p-4 rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-all";
                    const status = order.status;

                    if (userRole === '助销') {
                      if (status === '新建') cardClass = "bg-red-200 border-red-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                      else cardClass = "bg-green-200 border-green-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                    } else if (userRole === '财务') {
                      if (status === '助销已确认') cardClass = "bg-red-200 border-red-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                      else if (['财务已确认', '已通知备货', '已叫车', '已发货'].includes(status)) cardClass = "bg-green-200 border-green-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                    } else if (userRole === '仓管') {
                      if (['财务已确认', '已通知备货', '已叫车'].includes(status)) cardClass = "bg-red-200 border-red-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                      else if (status === '已发货') cardClass = "bg-green-200 border-green-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                    } else if (userRole === '销售' || userRole === 'admin') {
                      if (status === '已发货') cardClass = "bg-green-200 border-green-300 p-4 rounded-xl shadow-sm active:scale-[0.98]";
                    }

                    return (
                      <div 
                        key={order._docId} 
                        className={cardClass}
                        onClick={() => {
                          setViewingOrder(order);
                          setCurrentView('detail');
                        }}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-blue-600">#{order.id}</span>
                            {order.isPriority && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            order.status === '草稿'
                              ? 'bg-gray-100 text-gray-700 border-gray-200'
                              : 'bg-blue-600 text-white border-blue-600'
                          }`}>
                            {translateStatus(order.status)}
                          </span>
                        </div>
                        <div className="mb-4">
                          <div className="font-bold text-gray-900 text-lg leading-tight">{order.customer?.['客户名']}</div>
                          <div className="flex justify-between mt-1">
                            <span className="text-xs text-gray-500 flex items-center gap-1"><User className="w-3 h-3" /> {order.customer?.['销售']}</span>
                            <span className="text-xs text-gray-400">{order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString() : '-'}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                          {userRole !== '仓管' ? (
                            <div className="font-bold text-red-600 text-base">CFA {order.totalAmount?.toLocaleString()}</div>
                          ) : <div />}
                          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                            {userRole === '助销' && order.status === '新建' && (
                              <button 
                                onClick={() => handleUpdateOrderStatus(order._docId, '助销已确认')}
                                className="bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-bold"
                              >
                                {t('确认', 'Confirmer')}
                              </button>
                            )}
                            {(userRole === 'admin' || userRole === '助销' || order.authorUid === currentUser?.uid || userName?.trim() === order.customer?.['销售']?.trim() || userName?.trim() === order.salespersonName?.trim()) && (
                              <>
                                <button onClick={() => handleEditOrder(order)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                                <button 
                                  onClick={() => { setIsHardDelete(false); setDeleteConfirmId(order._docId); }} 
                                  className="p-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </>
                            )}
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

        {currentView === 'detail' && viewingOrder && (
          <div className="w-full max-w-5xl print:max-w-none print:m-0 print:p-0">
            <div className={printMode === 'french' ? 'print:hidden' : ''}>
              {/* Print Header */}
              <div className="hidden print:block mb-8 text-center relative">
                {viewingOrder.isPriority && (
                  <div className="absolute top-0 right-0 flex items-center gap-1 text-yellow-600 border border-yellow-600 px-3 py-1 rounded-full">
                    <Star className="w-5 h-5 fill-yellow-600" />
                    <span className="font-bold">加急单 / URGENT</span>
                  </div>
                )}
              <h1 className="text-3xl font-bold text-gray-900">备货单</h1>
              <div className="flex justify-between mt-4 text-gray-600 border-b pb-4">
                <span>订单号: {viewingOrder.id}</span>
                <div className="text-right">
                  <div className="print:hidden">创建时间: {viewingOrder.createdAt?.toDate ? viewingOrder.createdAt.toDate().toLocaleString() : '-'}</div>
                  <div className="hidden print:block">生成时间: {new Date().toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 print:hidden">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setCurrentView('list')} 
                  className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                
                {isEditingOrderId ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="theme-input text-lg px-2 py-1 w-32 font-bold"
                      value={orderIdInput}
                      onChange={(e) => setOrderIdInput(e.target.value)}
                      autoFocus
                    />
                    <button onClick={handleSaveOrderId} className="text-green-600"><CheckCircle2 className="w-5 h-5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-gray-800">#{viewingOrder.id}</h2>
                    {(userRole === 'admin' || userRole === '助销') && (
                      <button 
                        onClick={() => { setOrderIdInput(viewingOrder.id); setIsEditingOrderId(true); }} 
                        className="text-blue-500"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase border ${
                  viewingOrder.status === '草稿'
                    ? 'bg-gray-100 text-gray-700 border-gray-200'
                    : 'bg-blue-600 text-white border-blue-600'
                }`}>
                  {translateStatus(viewingOrder.status)}
                </span>
                {viewingOrder.isPriority && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-yellow-900" /> {t('加急', 'URGENT')}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 ml-0 sm:ml-auto">
                {/* Workflow Buttons */}
                {userRole === '助销' && viewingOrder.status === '新建' && (
                  <button 
                    onClick={() => handleUpdateOrderStatus(viewingOrder._docId, '助销已确认')}
                    className="bg-purple-600 text-white hover:bg-purple-700 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                  >
                    {t('确认', 'Confirmer')}
                  </button>
                )}
                {userRole === '财务' && viewingOrder.status === '助销已确认' && (
                  <button 
                    onClick={() => handleUpdateOrderStatus(viewingOrder._docId, '财务已确认')}
                    className="bg-green-600 text-white hover:bg-green-700 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                  >
                    {t('财务确认', 'Compta')}
                  </button>
                )}
                {userRole === '仓管' && ['财务已确认', '已通知备货', '已叫车', '已发货'].includes(viewingOrder.status) && (() => {
                  const currentSelected = pendingWarehouseStatuses[viewingOrder._docId] ?? viewingOrder.status;
                  const hasChanged = currentSelected !== viewingOrder.status;
                  return (
                    <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg p-1 px-2 shadow-sm">
                      <span className="text-xs text-orange-850 font-bold">{t('状态修改', 'Statut仓管')}:</span>
                      <select
                        value={currentSelected}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPendingWarehouseStatuses(prev => ({ ...prev, [viewingOrder._docId]: val }));
                        }}
                        className="text-xs bg-white text-gray-800 border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-orange-500 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="财务已确认">{translateStatus('财务已确认')}</option>
                        <option value="已通知备货">{translateStatus('已通知备货')}</option>
                        <option value="已叫车">{translateStatus('已叫车')}</option>
                        <option value="已发货">{translateStatus('已发货')}</option>
                      </select>
                      {hasChanged && (
                        <button
                          onClick={async () => {
                            await handleUpdateOrderStatus(viewingOrder._docId, currentSelected);
                            setPendingWarehouseStatuses(prev => {
                              const next = { ...prev };
                              delete next[viewingOrder._docId];
                              return next;
                            });
                          }}
                          className="text-xs bg-orange-600 hover:bg-orange-700 text-white font-bold px-3 py-1.5 rounded-md transition-all shadow-sm cursor-pointer"
                        >
                          {t('确认更新', 'Mettre à jour')}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Edit and Export buttons */}
                {(userRole === 'admin' || userRole === '助销' || viewingOrder.authorUid === currentUser?.uid || userName?.trim() === viewingOrder.customer?.['销售']?.trim() || userName?.trim() === viewingOrder.salespersonName?.trim()) && (
                  <>
                    <button
                      onClick={() => handleEditOrder(viewingOrder)}
                      className="p-3 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                      title={t('修改订单', 'Modifier')}
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => { setIsHardDelete(false); setDeleteConfirmId(viewingOrder._docId); }}
                      className="p-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-md"
                      title={t('作废订单', 'Annuler')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </>
                )}

                {userRole === '助销' && (
                  <button
                    onClick={handleExportExcel}
                    className="bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg transition-colors"
                    title={t("导出Excel", "Exporter Excel")}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                )}

                {(userRole === 'admin' || userRole === '销售') && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateOrderImage}
                      disabled={generatingImage || generatingPdf}
                      className={`p-2 ${generatingImage ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-xs`}
                      title={t("生成订单图片(Bon de Commande)", "Générer Image Commande")}
                    >
                      {generatingImage ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                      <span className="text-xs font-semibold hidden sm:inline">
                        {generatingImage ? t('生成中...', 'Image...') : t('生成图片', 'Image')}
                      </span>
                    </button>

                    <button
                      onClick={handleGenerateOrderPdf}
                      disabled={generatingPdf || generatingImage}
                      className={`p-2 ${generatingPdf ? 'bg-rose-300' : 'bg-rose-600 hover:bg-rose-700'} text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-xs`}
                      title={t("生成法语版PDF(Bon de Commande)", "Générer PDF Commande")}
                    >
                      {generatingPdf ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      <span className="text-xs font-semibold hidden sm:inline">
                        {generatingPdf ? t('生成中...', 'PDF...') : t('生成PDF', 'PDF')}
                      </span>
                    </button>
                  </div>
                )}

                {userRole === '仓管' && (
                  <button
                    onClick={() => window.print()}
                    className="bg-gray-800 text-white hover:bg-gray-900 p-2 rounded-lg transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 print:mb-4">
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm md:col-span-3 print:shadow-none print:border-gray-300 print:p-4">
                <h3 className="font-bold text-gray-800 mb-4 border-b pb-2">客户信息 <span className="text-gray-400 font-normal text-xs ml-2 print:inline">/ Informations Client</span></h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6 text-sm">
                  <div><span className="text-gray-500 block mb-1">名称 <span className="text-gray-400 text-xs print:inline">/ Nom</span></span> <span className="font-medium">{viewingOrder.customer?.['客户名']}</span></div>
                  <div className="print:hidden"><span className="text-gray-500 block mb-1">代码 <span className="text-gray-400 text-xs print:inline">/ Code</span></span> <span className="font-medium">{viewingOrder.customer?.['客户代码'] || '-'}</span></div>
                  {userRole !== '仓管' && (
                    <div className="print:hidden"><span className="text-gray-500 block mb-1">级别 <span className="text-gray-400 text-xs print:inline">/ Niveau</span></span> <span className="font-medium">{viewingOrder.customer?.['客户级别']}级</span></div>
                  )}
                  <div><span className="text-gray-500 block mb-1">电话 <span className="text-gray-400 text-xs print:inline">/ Tél</span></span> <span className="font-medium">{viewingOrder.customer?.['电话号码'] || '-'}</span></div>
                  <div>
                    <span className="text-gray-500 block mb-1">销售 <span className="text-gray-400 text-xs print:inline">/ Vendeur</span></span>
                    <span className="font-medium">{viewingOrder.customer?.['销售'] || '-'}</span>
                  </div>
                  <div><span className="text-gray-500 block mb-1">地区 <span className="text-gray-400 text-xs print:inline">/ Région</span></span> <span className="font-medium">{viewingOrder.customer?.['所在地区'] || '-'}</span></div>
                  {userRole !== '仓管' && (
                    <>
                      <div>
                        <span className="text-gray-500 block mb-1">{t('总信用额度', 'Crédit Total')}</span>
                        <span className="font-medium font-mono text-blue-700">
                          CFA {Math.round(getCustomerCreditStats(viewingOrder.customer).totalCredit).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block mb-1">{t('所剩信用额度', 'Crédit Restant')}</span>
                        <span className={`font-medium font-mono ${getCustomerCreditStats(viewingOrder.customer).remainingCredit < 0 ? 'text-red-600 font-bold' : 'text-green-700'}`}>
                          CFA {Math.round(getCustomerCreditStats(viewingOrder.customer).remainingCredit).toLocaleString('zh-CN')}
                          {getCustomerCreditStats(viewingOrder.customer).remainingCredit < 0 ? ` (${t('已超额', 'Dépassement')})` : ''}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-3">
                    <span className="text-gray-500 block mb-1">{t('备注', 'Note')}</span>
                    <div className="font-medium text-gray-900 break-words block">
                      {renderRemarksWithRedOverdue(viewingOrder.customer?.['备注']) || '-'}
                    </div>
                  </div>
                </div>

                {userRole !== '仓管' && (() => {
                  const stats = getCustomerCreditStats(viewingOrder.customer);
                  const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
                  if (custDebts.length === 0 && totalCredit === 0) return null;

                  return (
                    <div className="mt-4 p-3.5 bg-red-50/80 border border-red-200 rounded-lg text-xs">
                      <div className="flex flex-wrap items-center justify-between font-bold text-red-800 mb-2 gap-2">
                        <span className="flex items-center gap-1.5 text-sm">
                          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          <span>{t('客户信用与欠款情况', 'Situation crédit & impayés client')}</span>
                        </span>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-200">
                            {t('总信用额度', 'Crédit Total')}: <span className="text-blue-700">CFA {Math.round(totalCredit).toLocaleString('zh-CN')}</span>
                          </span>
                          <span className={`font-bold px-2 py-0.5 rounded border ${remainingCredit < 0 ? 'bg-red-100 border-red-300 text-red-800' : 'bg-white border-green-200 text-green-800'}`}>
                            {t('所剩信用额度', 'Crédit Restant')}: <span>CFA {Math.round(remainingCredit).toLocaleString('zh-CN')}</span>
                          </span>
                          <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-red-100">
                            {t('总欠款', 'Total Dû')}: <span className="text-red-700">CFA {Math.round(totalDebt).toLocaleString('zh-CN')}</span>
                          </span>
                        </div>
                      </div>
                      {overdueTotal > 0 && (
                        <div className="text-red-700 font-semibold mb-2 bg-red-100/80 p-2 rounded border border-red-200 flex items-center justify-between">
                          <span>⚠️ {t('已逾期欠款', 'Dont impayés échus / en retard')}:</span>
                          <span className="font-bold text-red-800 text-sm">CFA {Math.round(overdueTotal).toLocaleString('zh-CN')} ({overdueDebts.length} {t('笔到期未结', 'échéance(s)')})</span>
                        </div>
                      )}
                      {custDebts.length > 0 && (
                        <div className="space-y-1 max-h-36 overflow-y-auto bg-white p-2 rounded border border-red-100 font-mono text-xs">
                          {custDebts.map((d, dIdx) => {
                            const isOd = checkIsOverdue(d.dueDate);
                            return (
                              <div key={dIdx} className={`flex justify-between items-center py-1 px-1.5 rounded ${isOd ? 'bg-red-50/70 text-red-700 font-bold' : 'text-gray-700 border-b border-gray-50 last:border-0'}`}>
                                <span>{d.dueDate} {isOd ? `(${t('已逾期', 'En retard')})` : ''}</span>
                                <span>CFA {Math.round(d.amount).toLocaleString('zh-CN')}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Remarks Section */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 print:shadow-none print:border-gray-300 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center p-4 border-b bg-gray-50 flex-shrink-0">
                <h3 className="font-bold text-gray-800">留言板 <span className="text-gray-400 font-normal text-xs ml-2 print:inline">/ Message Board</span></h3>
              </div>
              
              <div className="p-4 text-sm text-gray-700 whitespace-pre-wrap flex-grow space-y-2" style={{minHeight: '100px'}}>
                {!viewingOrder.remarks ? <span className="text-gray-400 italic">暂无留言 / Aucun message</span> : 
                  (() => {
                    const allLines = viewingOrder.remarks.split('\n');
                    const filteredLines = allLines.filter((line: string) => {
                      const trimmed = line.trim();
                      if (!trimmed) return false;

                      // If role is not 仓管, show all lines
                      if (userRole !== '仓管') return true;

                      // If role is 仓管, show system notifications
                      const sysLogMatch = trimmed.match(/^\[(系统日志|Log Système)\s([0-9/: \-]+)\s([^\]]+)\]:(.*)/);
                      if (sysLogMatch) return true;

                      // Show if mentioned (either by user's actual username, @仓管, or @仓库)
                      const isMentioned = (userName && trimmed.includes(`@${userName}`)) || 
                                          trimmed.includes(`@仓管`) || 
                                          trimmed.includes(`@仓库`) || 
                                          (userRole && trimmed.includes(`@${userRole}`));
                      if (isMentioned) return true;

                      // Show if authored by this user
                      const matchAuthor = trimmed.match(/^\[([^\]]+)\]:/);
                      if (matchAuthor) {
                        const bracketContent = matchAuthor[1];
                        if (userName && (bracketContent === userName || bracketContent.endsWith(' ' + userName))) {
                          return true;
                        }
                      }

                      return false;
                    });

                    if (filteredLines.length === 0) {
                      return <span className="text-gray-400 italic">暂无留言 / Aucun message</span>;
                    }

                    return filteredLines.map((line: string, i: number) => {
                      const match = line.match(/\[IMAGE:(.+?)\]/);
                      if (match) {
                        const imageId = match[1];
                        return (
                          <div key={i} className="my-2">
                            <div className="text-xs text-gray-400 mb-1">{line.replace(/\[IMAGE:.+?\]/, '').trim()}</div>
                            <RemarkImage imageId={imageId} onZoom={setZoomedImage} />
                          </div>
                        );
                      }
                      
                      const isMentioned = (userName && line.includes(`@${userName}`)) || 
                                          line.includes(`@仓管`) || 
                                          line.includes(`@仓库`) || 
                                          (userRole && line.includes(`@${userRole}`));
                      
                      // Regex to match: [Prefix Timestamp User]: Action 【Status】
                      const sysLogMatch = line.match(/^\[(系统日志|Log Système)\s([0-9/: \-]+)\s([^\]]+)\]:(.*)/);
                      const isSystemLog = !!sysLogMatch;

                      if (sysLogMatch) {
                        const timestamp = sysLogMatch[2];
                        const operator = sysLogMatch[3];
                        const actionBody = sysLogMatch[4];
                        
                        const translatedPrefix = isFrench ? 'Log Système' : '系统日志';
                        const tagColor = isMentioned 
                          ? 'text-red-705 bg-red-100 border border-red-300 font-bold' 
                          : 'text-gray-650 bg-gray-100 border border-gray-300';
                        
                        // Identify and translate action text and status
                        let displayAction = actionBody;
                        const statusMatch = actionBody.match(/【([^】]+)】/);
                        if (statusMatch) {
                          const content = statusMatch[1];
                          // Check for DIFF format: ADD:CODE:QTY, REM:CODE:QTY, CHG:CODE:OLD:NEW
                          if (content.includes('ADD:') || content.includes('REM:') || content.includes('CHG:')) {
                             const parts = content.split(', ');
                             const translatedItems = parts.map(it => {
                                const [type, code, val1, val2] = it.split(':');
                                const priceItem = prices.find((p: any) => p['物料代码'] === code);
                                const name = isFrench 
                                  ? (getFrenchName(priceItem) || code) 
                                  : (priceItem?.['物料名称'] || code); 
                                
                                if (type === 'ADD') return `${isFrench ? 'Ajouté' : '增加了'} ${name} x${val1}`;
                                if (type === 'REM') return `${isFrench ? 'Supprimé' : '减少了'} ${name} x${val1}`;
                                if (type === 'CHG') return `${isFrench ? 'Modifié' : '修改了'} ${name} (${val1} → ${val2})`;
                                return it;
                             });
                             const actionText = isFrench ? ' a modifié le contenu: ' : ' 修改了内容: ';
                             displayAction = `${actionText}【${translatedItems.join(', ')}】`;
                          } else {
                            const status = content;
                            const translatedStatus = translateStatus(status);
                            const translatedActionText = isFrench ? ' Statut mis à jour à ' : ' 将订单状态更新为 ';
                            displayAction = `${translatedActionText}【${translatedStatus}】`;
                          }
                        }

                        return (
                          <div key={i} className={`min-h-[1em] mb-1 p-1.5 rounded-lg ${isMentioned ? 'bg-red-50 border-l-4 border-red-500 shadow-sm' : 'bg-gray-50/60 border-l-2 border-gray-300'}`}>
                            <span className={isMentioned ? 'text-red-600 font-bold text-base' : 'text-gray-900 font-normal text-sm'}>
                              <span className={`${tagColor} font-medium text-[13px] mr-2 px-1.5 py-0.5 rounded border inline-block`}>
                                [{translatedPrefix} {timestamp} {operator}]
                              </span>
                              {displayAction}
                            </span>
                          </div>
                        );
                      }
                      
                      const prefixMatch = line.match(/^\[(.*?20\d{2}\/\d{2}\/\d{2} \d{2}:\d{2} .*?)\]:/); // Match generic [timestamp user]: format
                      if (prefixMatch) {
                        const tagColor = isMentioned 
                          ? 'text-red-705 bg-red-100 border border-red-300 font-bold text-[13px] mr-2 px-1.5 py-0.5 rounded border inline-block' 
                          : 'text-blue-600 bg-blue-50 text-[13px] mr-2 px-1 rounded';
                        return (
                          <div key={i} className={`min-h-[1em] mb-1 p-1.5 rounded-lg ${isMentioned ? 'bg-red-50 border-l-4 border-red-500 shadow-sm' : ''}`}>
                            <span className={tagColor}>
                              {prefixMatch[1]}
                            </span>
                            <span className={`${isMentioned ? 'text-red-600 font-bold text-base' : 'text-gray-800'}`}>
                              {line.substring(prefixMatch[0].length)}
                            </span>
                          </div>
                        );
                      }
                      
                      // Fallback for older formats or plain text lines
                      const oldPrefixMatch = line.match(/^\[(.*?)\]:/); // old format like [4/17 9:00 user]:
                      if (oldPrefixMatch) {
                        const tagColor = isMentioned 
                          ? 'text-red-705 bg-red-100 border border-red-350 font-bold text-[13px] mr-2 px-1.5 py-0.5 rounded border inline-block' 
                          : 'text-blue-600 bg-blue-50 text-[13px] mr-2 px-1 rounded';
                        return (
                          <div key={i} className={`min-h-[1em] mb-1 p-1.5 rounded-lg ${isMentioned ? 'bg-red-50 border-l-4 border-red-500 shadow-sm' : ''}`}>
                            <span className={tagColor}>[{oldPrefixMatch[1]}]</span>
                            <span className={`${isMentioned ? 'text-red-600 font-bold text-base' : 'text-gray-800'}`}>{line.substring(oldPrefixMatch[0].length)}</span>
                          </div>
                        );
                      }
                      
                      return <div key={i} className={`min-h-[1em] mb-1 p-1.5 rounded-lg ${isMentioned ? 'text-red-600 font-bold text-base bg-red-50 border-l-4 border-red-500 shadow-sm' : 'text-gray-800'}`}>{line}</div>;
                    });
                  })()
                }
              </div>

              {currentUser && (
                <div className="p-4 border-t bg-gray-50 flex-shrink-0 flex flex-col gap-2 print:hidden">
                  <div className="flex gap-2 flex-wrap items-center">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">@ 提醒人:</span>
                    {publicUsers.filter(u => {
                      const currentUsername = currentUser?.email?.split('@')[0];
                      if (u.username === currentUsername) return false;
                      if (u.role === 'admin') return false;
                      
                      // Allow Finance, Assistant, and Warehouse roles
                      const allowedBaseRoles = ['财务', '助销', '仓管'];
                      if (allowedBaseRoles.includes(u.role)) return true;
                      
                      // Also allow the salesperson assigned to this specific order
                      const orderSales = viewingOrder?.customer?.['销售'];
                      if (u.role === '销售' && u.username === orderSales) return true;
                      
                      return false;
                    }).map(u => {
                      const colors: Record<string, string> = {
                        '仓管': 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100',
                        '财务': 'bg-green-50 text-green-600 border-green-100 hover:bg-green-100',
                        '助销': 'bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100',
                      };
                      const colorClass = colors[u.role] || 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200';
                      return (
                        <button 
                          key={u.username}
                          onClick={() => setRemarksInput(prev => prev + ` @${u.username} `)} 
                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${colorClass}`}
                        >
                          {u.username} <span className="opacity-60 text-[10px]">({u.role})</span>
                        </button>
                      );
                    })}
                    <div className="flex-1"></div>
                    <button 
                      onClick={() => hiddenFileInput.current?.click()}
                      disabled={isUploadingImage}
                      className="px-2 py-1 text-xs bg-white text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      {isUploadingImage ? <Loader2 className="w-3 h-3 animate-spin"/> : <ImageIcon className="w-3 h-3" />} 
                      插图
                    </button>
                    <input type="file" accept="image/*" ref={hiddenFileInput} onChange={handleImageUpload} className="hidden" />
                  </div>
                  <textarea
                    className="theme-input w-full p-2 text-sm min-h-[60px] resize-y"
                    value={remarksInput}
                    onChange={(e) => setRemarksInput(e.target.value)}
                    onPaste={handlePasteRemarks}
                    placeholder={t("在此输入您的留言，点击下方按钮发送...", "Tapez votre message ici...")}
                  />
                  <div className="flex justify-end mt-1">
                    <button 
                      onClick={handleSaveRemarks} 
                      disabled={!remarksInput.trim()}
                      className="px-4 py-2 text-sm bg-blue-600 disabled:bg-blue-300 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" /> {t("发送", "Envoyer")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
              <div className="p-6 border-b border-gray-200 print:p-4">
                <h3 className="font-bold text-gray-800">{t('订单明细', 'Détails de la Commande')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 font-medium">{t('物料名称', 'Produit')}</th>
                      <th className="px-6 py-3 font-medium">{t('颜色', 'Couleur')}</th>
                      <th className="px-6 py-3 font-medium">{t('物料编码', 'Code')}</th>
                      <th className="px-6 py-3 font-medium">{t('规格型号', 'Spécification')}</th>
                      <th className="px-6 py-3 font-medium text-right">{t('数量', 'Quantité')}</th>
                      {userRole !== '仓管' && (
                        <>
                          <th className="px-6 py-3 font-medium text-right">{t('单价 (CFA)', 'Prix (CFA)')}</th>
                          <th className="px-6 py-3 font-medium text-right">{t('小计 (CFA)', 'Sous-total')}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {viewingOrder.items?.map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4">{translateProduct(item)}</td>
                        <td className="px-6 py-4">{translateColor(item.color)}</td>
                        <td className="px-6 py-4 text-gray-500">{item.inventoryCode || item.materialCode}</td>
                        <td className="px-6 py-4 text-gray-500">{item.specification || '-'}</td>
                        <td className="px-6 py-4 text-right font-medium">{item.quantity}</td>
                        {userRole !== '仓管' && (
                          <>
                            <td className="px-6 py-4 text-right text-gray-600">{item.unitPrice?.toFixed(0)}</td>
                            <td className="px-6 py-4 text-right font-medium">{item.totalPrice?.toFixed(0)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={4} className="px-6 py-4 text-right font-bold text-gray-700">{t('总计:', 'Total:')}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-900 text-lg">
                        {viewingOrder.items?.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0) || 0}
                      </td>
                      {userRole !== '仓管' && (
                        <>
                          <td className="px-6 py-4 text-right font-bold text-gray-700">{t('总金额:', 'Total Montant:')}</td>
                          <td className="px-6 py-4 text-right font-bold text-blue-600 text-lg">
                            CFA {viewingOrder.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                        </>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            </div>

            <div ref={orderExportRef} style={{ display: 'none', position: 'static', width: '200mm', background: 'white', padding: '10mm', boxSizing: 'border-box', color: 'black', fontFamily: 'Arial, sans-serif' }}>
              <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <h1 style={{ fontSize: '28px', margin: '0 0 10px 0', fontWeight: 'bold' }}>Bon de Commande</h1>
              </div>
              
              <div style={{ marginBottom: '20px', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ marginBottom: '5px' }}><strong>Client:</strong> {viewingOrder.customer?.['客户名']}</div>
                  <div style={{ marginBottom: '5px' }}><strong>Code Client:</strong> {viewingOrder.customer?.['客户代码'] || customers.find(c => c['客户名'] === viewingOrder.customer?.['客户名'])?.['客户代码'] || '-'}</div>
                  <div style={{ marginBottom: '5px' }}><strong>Tél:</strong> {viewingOrder.customer?.['电话号码'] || '-'}</div>
                  <div><strong>Région:</strong> {viewingOrder.customer?.['所在地区'] || '-'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ marginBottom: '5px' }}><strong>Date:</strong> {new Date().toLocaleDateString('fr-FR')}</div>
                  <div><strong>No. Commande:</strong> {viewingOrder.id?.slice(-8).toUpperCase()}</div>
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

                    viewingOrder.items?.forEach((item: any) => {
                      const name = item.materialName || '';
                      const cat = categories.find(c => c.check(name));
                      if (cat) grouped[cat.id].push(item);
                    });

                    return categories.map(cat => {
                      const items = grouped[cat.id];
                      if (items.length === 0) return null;

                      // Group by material code to sum quantities
                      const materialGroups: Record<string, any> = {};
                      items.forEach(item => {
                        const code = item.materialCode;
                        if (!materialGroups[code]) {
                          materialGroups[code] = {
                            ...item,
                            quantity: 0,
                            totalPrice: 0
                          };
                        }
                        materialGroups[code].quantity += Number(item.quantity) || 0;
                        materialGroups[code].totalPrice += Number(item.totalPrice) || 0;
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
                            const priceData = prices.find(p => p['物料代码'] === item.materialCode);
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
                      {Math.round(viewingOrder.totalAmount || 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Situation des Impayés Client */}
              {userRole !== '仓管' && (() => {
                const stats = getCustomerCreditStats(viewingOrder.customer);
                const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
                if (!custDebts || (custDebts.length === 0 && totalCredit === 0)) return null;

                return (
                  <div style={{ marginTop: '20px', border: '1.5px solid #dc2626', borderRadius: '6px', padding: '12px 14px', background: '#fffaf0', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #fecaca', paddingBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#991b1b' }}>
                        Situation Financière & Impayés Client (客户信用与欠款明细)
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#111827', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <span>Total Crédit (总信用额度): <strong style={{ color: '#1d4ed8' }}>CFA {Math.round(totalCredit).toLocaleString('zh-CN')}</strong></span>
                        <span>Crédit Restant (所剩信用额度): <strong style={{ color: remainingCredit < 0 ? '#b91c1c' : '#15803d' }}>CFA {Math.round(remainingCredit).toLocaleString('zh-CN')}{remainingCredit < 0 ? ' (Dépassement)' : ''}</strong></span>
                        <span>Total Impayés (总欠款): <strong style={{ color: '#b91c1c' }}>CFA {Math.round(totalDebt).toLocaleString('zh-CN')}</strong></span>
                      </div>
                    </div>

                    {overdueTotal > 0 && (
                      <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>⚠️ Impayés Échus (已逾期欠款):</span>
                        <span>CFA {Math.round(overdueTotal).toLocaleString('zh-CN')} ({overdueDebts.length} échéance(s) en retard)</span>
                      </div>
                    )}

                    {custDebts.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', background: '#ffffff', border: '1px solid #e5e7eb' }}>
                        <thead>
                          <tr style={{ background: '#f3f4f6', color: '#374151' }}>
                            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>Date d'échéance (到期日)</th>
                            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>Montant (金额 CFA)</th>
                            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', width: '140px' }}>Statut (状态)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custDebts.map((d, dIdx) => {
                            const isOd = checkIsOverdue(d.dueDate);
                            return (
                              <tr key={dIdx} style={{ background: isOd ? '#fff5f5' : '#ffffff' }}>
                                <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', fontWeight: isOd ? 'bold' : 'normal', color: isOd ? '#dc2626' : '#1f2937' }}>
                                  {d.dueDate}
                                </td>
                                <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', fontWeight: isOd ? 'bold' : 'normal', color: isOd ? '#dc2626' : '#1f2937' }}>
                                  CFA {Math.round(d.amount).toLocaleString('zh-CN')}
                                </td>
                                <td style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'center' }}>
                                  {isOd ? (
                                    <span style={{ color: '#dc2626', fontWeight: 'bold', background: '#fee2e2', padding: '2px 6px', borderRadius: '3px', fontSize: '11px', display: 'inline-block' }}>
                                      ÉCHU / 已逾期
                                    </span>
                                  ) : (
                                    <span style={{ color: '#15803d', fontWeight: '500', fontSize: '11px', display: 'inline-block' }}>
                                      En cours / 正常
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
          </div>
        )}

        {currentView === 'create' && (
          <>
            {/* Step Indicator */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', width: '100%', maxWidth: '700px', justifyContent: 'space-between' }}>
          {[1, 2, 3, 4].map(step => (
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
                if (step > 1 && !selectedSalesInCreate) {
                  setErrorMsg(t('请先选择销售人员', 'Veuillez d\'abord choisir un commercial'));
                  return;
                }
                if (step > 2 && !editableCustomer) {
                  setErrorMsg(t('请先选择客户', 'Veuillez d\'abord choisir un client'));
                  return;
                }
                if (step === 4 && orderItems.length === 0) {
                  setErrorMsg(t('请至少为一种物料分配数量', 'Veuillez d\'abord configurer les quantités'));
                  return;
                }
                setCurrentStep(step);
                setErrorMsg('');
              }}
            >
              {step === 1 ? t('① 销售人员', '① Commercial') : step === 2 ? t('② 客户信息', '② Client') : step === 3 ? t('③ 物料与数量', '③ Produit & Quantité') : t('④ 预览并保存', '④ Aperçu')}
            </div>
          ))}
        </div>

        {/* Section 1: Sales Selection */}
        {currentStep === 1 && currentView === 'create' && (
        <section className="theme-section" style={{ width: '100%', maxWidth: '600px', flexGrow: 0 }}>
          <div className="section-header">{t('① 选择销售人员', '① Sélection du Commercial')}</div>
          <div className="content-scroll">
            <div className="form-group">
              <label className="theme-label">{t('选择销售', 'Choisir le Commercial')}</label>
              <select 
                className="theme-select"
                value={
                  uniqueSales.find(
                    s => s.trim().toLowerCase() === selectedSalesInCreate.trim().toLowerCase()
                  ) || selectedSalesInCreate
                }
                onChange={(e) => {
                  setSelectedSalesInCreate(e.target.value);
                  setEditableCustomer(null);
                  setSelectedCustomerIndex('');
                }}
              >
                <option value="">-- {t('请选择', 'Veuillez choisir')} --</option>
                {uniqueSales
                  .filter(s => {
                    if (userRole === '销售' && userName) {
                      return s.trim().toLowerCase() === userName.trim().toLowerCase();
                    }
                    return true;
                  })
                  .map(s => <option key={s} value={s}>{s}</option>)
                }
              </select>
            </div>
            
            <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end', marginBottom: '80px'}}>
              <button 
                className="theme-btn btn-primary"
                onClick={() => {
                  if (!selectedSalesInCreate) {
                    setErrorMsg(t('请先选择销售人员', 'Veuillez d\'abord choisir un commercial'));
                    return;
                  }
                  setErrorMsg('');
                  setCurrentStep(2);
                }}
              >
                {t('下一步: 选择客户', 'Suivant: Choisir le Client')}
              </button>
            </div>
          </div>
        </section>
        )}

        {/* Section 2: Customer */}
        {currentStep === 2 && currentView === 'create' && (
        <section className="theme-section" style={{ width: '100%', maxWidth: '600px', flexGrow: 0 }}>
          <div className="section-header">{t('② 客户信息录入', '② Informations du Client')}</div>
          <div className="content-scroll">
            {/* Custom Searchable Select combobox */}
            <div className="form-group relative mb-4">
              <label className="theme-label">{t('选择/搜索客户', 'Choisir / Rechercher un Client')}</label>
              
              <div className="relative">
                <input
                  type="text"
                  className="theme-input w-full pr-10 cursor-pointer text-sm font-medium"
                  placeholder={t('🔍 输入客户名称/地区模糊搜索...', 'Rechercher un client...')}
                  value={
                    isCustomerDropdownOpen 
                      ? customerSearchQuery 
                      : (selectedCustomerIndex !== '' && customers[Number(selectedCustomerIndex)]
                          ? `${customers[Number(selectedCustomerIndex)]['客户名']}${customers[Number(selectedCustomerIndex)]['所在地区'] ? ` (${customers[Number(selectedCustomerIndex)]['所在地区']})` : ''}`
                          : ''
                        )
                  }
                  onChange={(e) => {
                    setCustomerSearchQuery(e.target.value);
                    setIsCustomerDropdownOpen(true);
                  }}
                  onFocus={() => {
                    setIsCustomerDropdownOpen(true);
                  }}
                  onClick={() => {
                    setIsCustomerDropdownOpen(true);
                  }}
                />
                
                {/* Arrow indicator / Clear button */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
                  {(selectedCustomerIndex !== '' || customerSearchQuery) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCustomerIndex('');
                        setCustomerSearchQuery('');
                        setEditableCustomer(null);
                        setIsCustomerDropdownOpen(false);
                      }}
                      className="text-gray-400 hover:text-gray-600 font-bold text-sm px-1"
                    >
                      ×
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCustomerDropdownOpen(!isCustomerDropdownOpen);
                    }}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Dropdown Options List */}
                {isCustomerDropdownOpen && (
                  <>
                    {/* Invisible overlay background to automatically close on outside click */}
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setIsCustomerDropdownOpen(false)} 
                    />
                    
                    <div className="absolute top-full left-0 right-0 mt-1 max-h-60 bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto z-20 divide-y divide-gray-50">
                      
                      {/* Filtered Customer List */}
                      {customers
                        .filter(c => String(c['销售'] || '').trim().toLowerCase() === String(selectedSalesInCreate || '').trim().toLowerCase())
                        .map((c) => {
                          const realIdx = customers.findIndex(orig => orig === c);
                          return { c, realIdx };
                        })
                        .filter(({ c }) => {
                          if (!customerSearchQuery.trim()) return true;
                          const q = customerSearchQuery.toLowerCase();
                          return (c['客户名'] || '').toLowerCase().includes(q) || 
                                 (c['所在地区'] || '').toLowerCase().includes(q) ||
                                 (c['客户代码'] || '').toLowerCase().includes(q);
                        })
                        .map(({ c, realIdx }) => (
                          <button
                            key={`dropdown-cust-${realIdx}`}
                            type="button"
                            onClick={() => {
                              handleSelectCustomer(realIdx.toString());
                              setIsCustomerDropdownOpen(false);
                              setCustomerSearchQuery('');
                            }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors flex flex-col justify-start gap-0.5 ${
                              selectedCustomerIndex === realIdx.toString()
                                ? 'bg-blue-600 text-white'
                                : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <span className="font-medium truncate">{c['客户名']}</span>
                            <span className={`text-[10px] ${
                              selectedCustomerIndex === realIdx.toString() ? 'text-blue-100' : 'text-gray-400'
                            }`}>
                              {c['客户代码'] ? `${c['客户代码']}` : ''} 
                              {c['所在地区'] ? ` • ${c['所在地区']}` : ''}
                            </span>
                          </button>
                        ))
                      }

                      {/* No match indicator */}
                      {customers
                        .filter(c => String(c['销售'] || '').trim().toLowerCase() === String(selectedSalesInCreate || '').trim().toLowerCase())
                        .filter(c => {
                          if (!customerSearchQuery.trim()) return true;
                          const q = customerSearchQuery.toLowerCase();
                          return (c['客户名'] || '').toLowerCase().includes(q) || 
                                 (c['所在地区'] || '').toLowerCase().includes(q) ||
                                 (c['客户代码'] || '').toLowerCase().includes(q);
                        }).length === 0 && (
                          <div className="px-4 py-3 text-xs text-gray-400 text-center italic">
                            {t('无匹配的现有客户', 'Aucun client correspondant')}
                          </div>
                        )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {editableCustomer && (
              <div className="info-card">
                <div className="info-row" style={{alignItems: 'center'}}>
                  <span className="info-label">{t('客户名称', 'Nom du Client')}</span>
                  <input 
                    className="theme-input bg-gray-50 cursor-not-allowed" 
                    style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                    value={editableCustomer['客户名'] || ''} 
                    readOnly
                  />
                </div>
                <div className="info-row" style={{alignItems: 'center'}}>
                  <span className="info-label">{t('客户代码', 'Code Client')}</span>
                  <input 
                    className="theme-input bg-gray-50 cursor-not-allowed" 
                    style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                    value={editableCustomer['客户代码'] || ''} 
                    readOnly
                  />
                </div>
                {userRole !== '仓管' && (
                  <div className="info-row" style={{alignItems: 'center'}}>
                    <span className="info-label">{t('客户级别', 'Niveau Client')}</span>
                    <select 
                      className="theme-select bg-gray-50 cursor-not-allowed opacity-80" 
                      style={{padding: '2px 6px', fontSize: '0.8rem', width: 'auto', minWidth: '80px'}}
                      value={editableCustomer['客户级别'] || 'A'}
                      disabled
                    >
                      <option value="A">A级 (A)</option>
                      <option value="B">B级 (B)</option>
                      <option value="C">C级 (C)</option>
                      <option value="D">D级 (D)</option>
                    </select>
                  </div>
                )}
                <div className="info-row" style={{alignItems: 'center'}}>
                  <span className="info-label">{t('所在地区', 'Région')}</span>
                  <input 
                    className="theme-input bg-gray-50 cursor-not-allowed" 
                    style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                    value={editableCustomer['所在地区'] || ''} 
                    readOnly
                  />
                </div>
                <div className="info-row" style={{alignItems: 'center'}}>
                  <span className="info-label">{t('电话号码', 'N° Téléphone')}</span>
                  <input 
                    className="theme-input bg-gray-50 cursor-not-allowed" 
                    style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                    value={editableCustomer['电话号码'] || ''} 
                    readOnly
                  />
                </div>
                <div className="info-row" style={{alignItems: 'center'}}>
                  <span className="info-label">{t('归属销售', 'Commercial')}</span>
                  <input 
                    className="theme-input bg-gray-50 cursor-not-allowed" 
                    style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                    value={editableCustomer['销售'] || ''} 
                    readOnly
                  />
                </div>
                {userRole !== '仓管' && (
                  <>
                    <div className="info-row" style={{alignItems: 'center'}}>
                      <span className="info-label">{t('总信用额度', 'Crédit Total')}</span>
                      <input 
                        className="theme-input bg-gray-50 cursor-not-allowed font-mono font-medium text-blue-700" 
                        style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                        value={`CFA ${Math.round(getCustomerCreditStats(editableCustomer).totalCredit).toLocaleString('zh-CN')}`} 
                        readOnly
                      />
                    </div>
                    <div className="info-row" style={{alignItems: 'center'}}>
                      <span className="info-label">{t('所剩信用额度', 'Crédit Restant')}</span>
                      <input 
                        className={`theme-input bg-gray-50 cursor-not-allowed font-mono font-bold ${
                          getCustomerCreditStats(editableCustomer).remainingCredit < 0 ? 'text-red-600 bg-red-50' : 'text-green-700'
                        }`} 
                        style={{padding: '2px 6px', fontSize: '0.8rem', flex: 1, marginLeft: '10px'}} 
                        value={`CFA ${Math.round(getCustomerCreditStats(editableCustomer).remainingCredit).toLocaleString('zh-CN')}${
                          getCustomerCreditStats(editableCustomer).remainingCredit < 0 ? ` (${t('已超额', 'Dépassement')})` : ''
                        }`} 
                        readOnly
                      />
                    </div>
                  </>
                )}
                <div className="info-row" style={{alignItems: 'flex-start'}}>
                  <span className="info-label font-semibold text-gray-800" style={{marginTop: '6px'}}>{t('备注', 'Note')}</span>
                  <div style={{flex: 1, marginLeft: '10px'}}>
                    <textarea 
                      className="theme-input w-full border border-gray-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-3 transition-all leading-relaxed" 
                      style={{
                        minHeight: '80px',
                        resize: 'vertical'
                      }} 
                      value={editableCustomer['备注'] || ''} 
                      onChange={(e) => {
                        setIsCustomerNoteManuallyEdited(true);
                        setEditableCustomer({
                          ...editableCustomer,
                          '备注': e.target.value
                        });
                      }}
                      placeholder={t('在此输入本次订单销售备注（可选，如送货要求、特殊约定等）...', 'Saisir ici les remarques particulières pour cette commande (optionnel)...')}
                    />
                  </div>
                </div>

                {userRole !== '仓管' && (() => {
                  const stats = getCustomerCreditStats(editableCustomer);
                  const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
                  if (custDebts.length === 0 && totalCredit === 0) return null;

                  return (
                    <div className="mt-3 p-3 bg-red-50/80 border border-red-200 rounded-lg text-xs">
                      <div className="flex flex-wrap items-center justify-between font-bold text-red-800 mb-1.5 gap-2">
                        <span className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                          <span>{t('客户信用与欠款情况', 'Situation crédit & impayés client')}</span>
                        </span>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-200">
                            {t('总信用额度', 'Crédit Total')}: <span className="text-blue-700">CFA {Math.round(totalCredit).toLocaleString('zh-CN')}</span>
                          </span>
                          <span className={`font-bold px-2 py-0.5 rounded border ${remainingCredit < 0 ? 'bg-red-100 border-red-300 text-red-800' : 'bg-white border-green-200 text-green-800'}`}>
                            {t('所剩信用额度', 'Crédit Restant')}: <span>CFA {Math.round(remainingCredit).toLocaleString('zh-CN')}</span>
                          </span>
                          <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-red-100">
                            {t('总欠款', 'Total Dû')}: <span className="text-red-700">CFA {Math.round(totalDebt).toLocaleString('zh-CN')}</span>
                          </span>
                        </div>
                      </div>
                      {overdueTotal > 0 && (
                        <div className="text-red-700 font-semibold mb-2 bg-red-100/70 p-1.5 rounded border border-red-200 flex items-center justify-between">
                          <span>⚠️ {t('已逾期欠款', 'Dont impayés échus / en retard')}:</span>
                          <span className="underline font-bold text-red-800">CFA {Math.round(overdueTotal).toLocaleString('zh-CN')} ({overdueDebts.length} {t('笔到期未结', 'échéance(s)')})</span>
                        </div>
                      )}
                      {custDebts.length > 0 && (
                        <div className="space-y-1 max-h-36 overflow-y-auto bg-white p-2 rounded border border-red-100 font-mono text-xs">
                          {custDebts.map((d, dIdx) => {
                            const isOd = checkIsOverdue(d.dueDate);
                            return (
                              <div key={dIdx} className={`flex justify-between items-center py-1 px-1.5 rounded ${isOd ? 'bg-red-50 text-red-700 font-bold' : 'text-gray-700 border-b border-gray-50 last:border-0'}`}>
                                <span>{d.dueDate} {isOd ? `(${t('已逾期', 'En retard')})` : ''}</span>
                                <span>CFA {Math.round(d.amount).toLocaleString('zh-CN')}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            
            <div style={{marginTop: '20px', display: 'flex', justifyContent: 'space-between', marginBottom: '80px'}}>
              <button 
                className="theme-btn btn-secondary" 
                style={{background: '#f1f5f9', color: 'var(--text-main)'}} 
                onClick={() => setCurrentStep(1)}
              >
                {t('上一步', 'Précédent')}
              </button>
              <button 
                className="theme-btn btn-primary"
                onClick={() => {
                  if (!editableCustomer) {
                    setErrorMsg(t('请先选择客户', 'Veuillez d\'abord choisir un client'));
                    return;
                  }
                  if (!editableCustomer['客户名']?.trim()) {
                    setErrorMsg(t('客户名称不能为空', 'Le nom du client ne peut pas être vide'));
                    return;
                  }
                  setErrorMsg('');
                  setCurrentStep(3);
                }}
              >
                {t('下一步: 选择物料', 'Suivant: Choisir le Produit')}
              </button>
            </div>
          </div>
        </section>
        )}

        {/* Combined Section 3: Material Selection & Configuration */}
        {currentStep === 3 && currentView === 'create' && (
        <section className="theme-section" style={{ width: '100%', maxWidth: '1000px', flexGrow: 0 }}>
          <div className="section-header">{t('③ 物料选择与数量配置', '③ Sélection & Configuration des Produits')}</div>
          <div className="content-scroll">
            
            {/* Inventory Update Time Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-5 shadow-sm">
              <div className="flex items-center flex-wrap gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="text-sm font-medium text-gray-700">
                  {t('库存更新时间', 'Mise à jour du stock')}：
                  <span className="font-semibold text-emerald-600 font-mono">
                    {inventoryUpdateTime ? formatInventoryUpdateTime(inventoryUpdateTime) : '-'}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={refreshInventory}
                disabled={refreshingInventory}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all border ${
                  refreshingInventory
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95'
                }`}
              >
                <svg
                  className={`w-3.5 h-3.5 ${refreshingInventory ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 3v5H16"
                  />
                </svg>
                {refreshingInventory 
                  ? t('正在刷新...', 'Actualisation...') 
                  : t('刷新库存', 'Rafraîchir le stock')}
              </button>
            </div>

            {/* Category Tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', background: 'var(--bg-main)', padding: '12px', borderRadius: '12px' }}>
              {['盆系列', '桶系列', '水壶水杯系列', '椅子凳子系列', '其他'].map(catZh => {
                const catFr = catZh === '盆系列' ? 'Bassines' : (catZh === '桶系列' ? 'Seaux' : (catZh === '水壶水杯系列' ? 'Gourdes' : (catZh === '椅子凳子系列' ? 'Chaises' : 'Autres')));
                const isCatActive = selectedCategory === catZh;
                return (
                <button
                  key={catZh}
                  onClick={() => setSelectedCategory(catZh)}
                  className={`px-4 py-2 rounded-full transition-all text-sm font-medium ${isCatActive ? 'bg-primary text-white shadow-md scale-105' : 'bg-white text-gray-600 border border-gray-200 hover:border-primary/50'}`}
                >
                  {t(catZh, catFr)}
                </button>
              )})}
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
                  customerLevel={customerLevel}
                  inventory={inventory}
                  prices={prices}
                  initialItems={draftOrderItems[m['物料代码']] || []}
                  onItemsChange={handleMaterialItemsChange}
                  onZoomImage={setZoomedImage}
                  translateColor={translateColor}
                  isFrench={isFrench}
                  todayConsumption={todayConsumption}
                  compact={true}
                />
              ))}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-6 border-t-2 border-gray-100 mb-20 sm:mb-0">
              <button className="theme-btn btn-secondary w-full sm:w-auto" style={{background: '#f1f5f9', color: 'var(--text-main)'}} onClick={() => setCurrentStep(2)}>{t('上一步', 'Précédent')}</button>
              <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                <div style={{textAlign: 'right'}}>
                  <div className="text-xs text-gray-400 uppercase">{t('已选款式', 'Styles sélectionnés')}</div>
                  <div className="text-xl font-bold text-primary">{Object.keys(draftOrderItems).filter(k => (draftOrderItems[k] || []).length > 0).length}</div>
                </div>
                <button 
                  className="theme-btn btn-primary flex-1 sm:flex-none"
                  style={{padding: '12px 32px'}}
                  onClick={() => {
                    if (orderItems.length === 0) {
                      setErrorMsg(t('请至少为一种物料分配数量', 'Veuillez au moins commander un produit'));
                      return;
                    }
                    setErrorMsg('');
                    setCurrentStep(4);
                  }}
                >
                  {t('预览订单', 'Aperçu')} <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Section 4: Order Summary */}
        {currentStep === 4 && currentView === 'create' && (
        <section className="theme-section" style={{ width: '100%', maxWidth: '600px', flexGrow: 1 }}>
          <div className="section-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <span>{t('④ 订单摘要', '④ Résumé de la commande')}</span>
            <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
              <span style={{fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal'}}>{t('单号:', 'N°:')}</span>
              <input 
                type="text" 
                className="theme-input" 
                style={{padding: '2px 8px', fontSize: '0.9rem', width: '120px', fontWeight: 'bold', color: 'var(--primary)'}} 
                value={generatedOrderId} 
                onChange={(e) => {
                  setGeneratedOrderId(e.target.value);
                  setIsOrderIdEdited(true);
                }} 
                placeholder={t('输入订单号', 'Entrez le N° de commande')}
              />
            </div>
          </div>
          <div className="content-scroll">
            
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 p-3 rounded-md flex items-start space-x-2 mb-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-red-700 text-sm">{errorMsg}</p>
              </div>
            )}
            {successMsg && (
              <div className="bg-green-50 border border-green-200 p-3 rounded-md flex items-start space-x-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                <p className="text-green-700 text-sm">{successMsg}</p>
              </div>
            )}

            {editableCustomer && (
              <div className="info-card" style={{marginBottom: '16px', background: 'white'}}>
                <div style={{fontSize: '0.8rem', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px'}}>
                  <strong>{t('客户信息', 'Informations Client')}:</strong>
                </div>
                <div style={{fontSize: '0.8rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'}}>
                <div style={{color: selectedCustomerIndex === 'NEW' ? 'red' : 'inherit'}}><span style={{color: 'var(--text-muted)'}}>{t('名称', 'Nom')}:</span> {editableCustomer['客户名']}</div>
                  <div><span style={{color: 'var(--text-muted)'}}>{t('代码', 'Code')}:</span> {editableCustomer['客户代码'] || '-'}</div>
                  {userRole !== '仓管' && (
                    <div><span style={{color: 'var(--text-muted)'}}>{t('级别', 'Niveau')}:</span> {editableCustomer['客户级别']}{t('级', '')}</div>
                  )}
                  <div><span style={{color: 'var(--text-muted)'}}>{t('电话', 'Tél')}:</span> {editableCustomer['电话号码'] || '-'}</div>
                  <div><span style={{color: 'var(--text-muted)'}}>{t('销售', 'Vendeur')}:</span> {editableCustomer['销售'] || '-'}</div>
                  <div><span style={{color: 'var(--text-muted)'}}>{t('地区', 'Région')}:</span> {editableCustomer['所在地区'] || '-'}</div>
                  {userRole !== '仓管' && (
                    <>
                      <div>
                        <span style={{color: 'var(--text-muted)'}}>{t('总信用额度', 'Crédit Total')}:</span>{' '}
                        <strong className="text-blue-700 font-mono">
                          CFA {Math.round(getCustomerCreditStats(editableCustomer).totalCredit).toLocaleString('zh-CN')}
                        </strong>
                      </div>
                      <div>
                        <span style={{color: 'var(--text-muted)'}}>{t('所剩信用额度', 'Crédit Restant')}:</span>{' '}
                        <strong className={`font-mono ${getCustomerCreditStats(editableCustomer).remainingCredit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                          CFA {Math.round(getCustomerCreditStats(editableCustomer).remainingCredit).toLocaleString('zh-CN')}
                          {getCustomerCreditStats(editableCustomer).remainingCredit < 0 ? ` (${t('已超额', 'Dépassement')})` : ''}
                        </strong>
                      </div>
                    </>
                  )}
                  <div className="col-span-2 border-t border-gray-100 pt-2 mt-1">
                    <span style={{color: 'var(--text-muted)'}} className="font-semibold block mb-1">{t('备注', 'Note')}:</span> 
                    <div className="bg-gray-50 rounded-md p-2.5 text-gray-800 break-words font-mono leading-relaxed text-xs">
                      {renderRemarksWithRedOverdue(editableCustomer['备注']) || '-'}
                    </div>
                  </div>
                </div>

                {userRole !== '仓管' && (() => {
                  const stats = getCustomerCreditStats(editableCustomer);
                  const { totalCredit, totalDebt, remainingCredit, custDebts, overdueDebts, overdueTotal } = stats;
                  if (custDebts.length === 0 && totalCredit === 0) return null;

                  return (
                    <div className="mt-3 p-3 bg-red-50/80 border border-red-200 rounded-lg text-xs">
                      <div className="flex flex-wrap items-center justify-between font-bold text-red-800 mb-1.5 gap-2">
                        <span className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                          <span>{t('客户信用与欠款情况', 'Situation crédit & impayés client')}</span>
                        </span>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="bg-white px-1.5 py-0.5 rounded border border-blue-200 text-blue-800">
                            {t('总额度', 'Crédit')}: CFA {Math.round(totalCredit).toLocaleString('zh-CN')}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border ${remainingCredit < 0 ? 'bg-red-100 border-red-300 text-red-800 font-bold' : 'bg-white border-green-200 text-green-800'}`}>
                            {t('剩余', 'Restant')}: CFA {Math.round(remainingCredit).toLocaleString('zh-CN')}
                          </span>
                          <span className="bg-white px-1.5 py-0.5 rounded border border-red-100 text-red-700">
                            {t('总欠款', 'Total Dû')}: CFA {Math.round(totalDebt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                      </div>
                      {overdueTotal > 0 && (
                        <div className="text-red-700 font-semibold mb-2 bg-red-100/70 p-1.5 rounded border border-red-200">
                          ⚠️ {t('已逾期欠款', 'Dont impayés échus / en retard')}: <span className="underline font-bold text-red-800">CFA {Math.round(overdueTotal).toLocaleString('zh-CN')}</span> ({overdueDebts.length} {t('笔到期未结', 'échéance(s)')})
                        </div>
                      )}
                      {custDebts.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto bg-white p-2 rounded border border-red-100 font-mono text-xs">
                          {custDebts.map((d, dIdx) => {
                            const isOd = checkIsOverdue(d.dueDate);
                            return (
                              <div key={dIdx} className={`flex justify-between items-center py-0.5 border-b border-gray-50 last:border-0 ${isOd ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
                                <span>{d.dueDate} {isOd ? `(${t('已逾期', 'En retard')})` : ''}</span>
                                <span>CFA {Math.round(d.amount).toLocaleString('zh-CN')}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="info-card" style={{background: 'white'}}>
              <div style={{fontSize: '0.8rem', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px'}}>
                <strong>{t('已选项目', 'Articles Sélectionnés')}:</strong>
              </div>
              
              {groupedOrderItems.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">
                  暂无物料，请返回上一步添加
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedOrderItems.map((group) => (
                    <div key={group.materialCode} style={{border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden'}}>
                      {/* Summary Row */}
                      <div 
                        style={{padding: '10px', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}}
                        onClick={() => toggleMaterialExpanded(group.materialCode)}
                      >
                        <div style={{flex: 1}}>
                          <div style={{fontWeight: 600, fontSize: '0.85rem'}}>{group.materialName}</div>
                          <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px'}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                              <span>{t('总数', 'Total')}:</span>
                              <input 
                                type="number"
                                className="theme-input no-spin"
                                style={{width: '60px', padding: '1px 4px', fontSize: '0.75rem', height: '22px', border: '1px solid var(--primary-light)', borderRadius: '4px'}}
                                value={group.totalQuantity}
                                onChange={(e) => handleUpdateItemGroupQuantity(group.materialCode, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <span style={{opacity: 0.3}}>|</span>
                            <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                              <span>{t('单价', 'P.U.')}:</span>
                              <input 
                                type="number"
                                className="theme-input no-spin"
                                style={{width: '70px', padding: '1px 4px', fontSize: '0.75rem', height: '22px', border: '1px solid var(--primary-light)', borderRadius: '4px'}}
                                value={group.unitPrice}
                                onChange={(e) => handleUpdateItemPrice(group.materialCode, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <span style={{opacity: 0.3}}>|</span>
                            <span style={{fontWeight: 'bold', color: 'var(--primary)'}}>{t('小计', 'S.Total')}: CFA {group.totalPrice.toFixed(0)}</span>
                          </div>
                        </div>
                        <div style={{color: 'var(--text-muted)', marginLeft: '8px'}}>
                          {expandedMaterials[group.materialCode] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </div>
                      </div>
                      
                      {/* Details (Colors) */}
                      {expandedMaterials[group.materialCode] && (
                        <div style={{padding: '10px', background: 'white', borderTop: '1px solid var(--border)'}}>
                          {group.items.map(item => {
                            const priceItem = prices.find(p => p['物料代码'] === group.materialCode);
                            const chineseName = priceItem ? priceItem['物料名称'] : group.materialName;
                            const invItem = inventory.find(i => 
                              i['物料名称']?.trim() === (chineseName || '').trim() && 
                              i['颜色'] === item.color &&
                              (item.specification && item.specification !== '-' ? i['规格型号'] === item.specification : true)
                            );
                            
                            let available = '0';
                            if (invItem) {
                              const invCode = (invItem[' 物料编码 '] || (invItem as any)['物料编码'] || '').trim();
                              const base = Number(invItem['可用量']) || 0;
                              const consumed = todayConsumption[invCode] || 0;
                              available = Math.max(0, base - consumed).toString();
                            }

                            return (
                              <div key={item.id} className="relative pr-8 py-2 border-b border-gray-100 last:border-0" style={{marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                <div>
                                  <div style={{fontSize: '0.8rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px'}}>
                                    <span>{t('颜色', 'Couleur')}: {translateColor(item.color)}</span>
                                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">
                                      {t('库存', 'Stock')}: {available}
                                    </span>
                                  </div>
                                  <div style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>{t('物料编码', 'Code Inv')}: {item.inventoryCode || '-'} | {t('规格型号', 'Spec')}: {item.specification || '-'}</div>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                  <input 
                                    type="number"
                                    min="0"
                                    className="theme-input no-spin"
                                    style={{width: '60px', padding: '4px', fontSize: '0.8rem', textAlign: 'center'}}
                                    value={item.quantity}
                                    onChange={(e) => handleUpdateItemQuantity(item.materialCode, item.id, e.target.value)}
                                  />
                                </div>
                                <button 
                                  onClick={() => handleRemoveItem(item.id, item.materialCode)}
                                  className="absolute right-0 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-600"
                                  title="移除此颜色"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="info-card" style={{background: 'white', marginTop: '16px'}}>
              <div style={{fontSize: '0.8rem', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px'}}>
                <strong>{t('订单备注', 'Notes de la Commande')}:</strong>
              </div>
              <div className="flex gap-2 mb-1 flex-wrap items-center">
                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">@ 提醒人:</span>
                {publicUsers.filter(u => {
                  const currentUsername = currentUser?.email?.split('@')[0];
                  if (u.username === currentUsername) return false;
                  if (u.role === 'admin') return false;
                  
                  // Allow Finance, Assistant, and Warehouse roles
                  const allowedBaseRoles = ['财务', '助销', '仓管'];
                  if (allowedBaseRoles.includes(u.role)) return true;
                  
                  // Also allow the selected salesperson for this order
                  if (u.role === '销售' && u.username && u.username.trim().toLowerCase() === selectedSalesInCreate.trim().toLowerCase()) return true;
                  
                  return false;
                }).map(u => {
                  const colors: Record<string, string> = {
                    '仓管': 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100',
                    '财务': 'bg-green-50 text-green-600 border-green-100 hover:bg-green-100',
                    '助销': 'bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100',
                  };
                  const colorClass = colors[u.role] || 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200';
                  return (
                    <button 
                      key={u.username}
                      onClick={() => setOrderRemarks(prev => prev + ` @${u.username} `)} 
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${colorClass}`}
                    >
                      {u.username} <span className="opacity-60 text-[10px]">({u.role})</span>
                    </button>
                  );
                })}
              </div>
              <textarea
                className="theme-input w-full p-3 text-sm min-h-[80px]"
                value={orderRemarks}
                onChange={(e) => setOrderRemarks(e.target.value)}
                placeholder="在此输入订单备注留言（选填）..."
              />
            </div>

            <div className="summary-total">
              <div className="total-row" style={{marginBottom: '8px'}}>
                <span className="info-label">{t('总数量', 'Qté Totale')}</span>
                <span style={{fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)'}}>
                  {orderItems.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0)}
                </span>
              </div>
              <div className="total-row">
                <span className="info-label">{t('预计总额', 'Total Estimé')}</span>
                <span style={{fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)'}}>CFA {orderTotal.toFixed(0)}</span>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2 mt-4 mb-20 sm:mb-0">
                <button 
                  type="button"
                  className="theme-btn w-full flex-1"
                  style={{background: '#f1f5f9', color: 'var(--text-main)'}}
                  onClick={() => setCurrentStep(3)}
                >
                  {t('继续修改', 'Retour')}
                </button>
                <button 
                  type="button"
                  className="theme-btn w-full flex-1 transition-all"
                  style={{background: '#cbd5e1', color: '#1e293b'}}
                  onClick={() => handleSaveOrder(true)}
                  disabled={saving || orderItems.length === 0 || !editableCustomer}
                >
                  {saving ? t('保存中...', 'Enregistrement...') : t('保存订单草稿', 'Enregister le brouillon')}
                </button>
                <button 
                  type="button"
                  className="theme-btn btn-primary w-full flex-1" 
                  onClick={() => handleSaveOrder(false)}
                  disabled={saving || orderItems.length === 0 || !editableCustomer}
                >
                  {saving ? t('保存中...', 'Enregistrement...') : t('确认并提交订单', 'Confirmer & Envoyer')}
                </button>
              </div>
              <p className="status-msg">{t('订单将自动同步至后端库', 'La commande sera synchronisée avec le serveur')}</p>
            </div>
          </div>
        </section>
        )}

          </>
        )}
        {currentView === 'users' && userRole === 'admin' && (
          <div className="w-full max-w-4xl mx-auto">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-200 flex flex-wrap justify-between items-center bg-gray-50 gap-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="w-6 h-6 text-blue-600" />
                  账号与角色管理
                </h2>

                {/* System Maintenance Switch */}
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg py-1.5 px-3 shadow-md">
                  <span className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    ⚠️ {isFrench ? 'Maintenance Système' : '系统维护状态'}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const newStatus = !maintenanceMode;
                        await setDoc(doc(db, 'settings', 'system'), { maintenance: newStatus }, { merge: true });
                        alert(newStatus ? '系统维护已开启！除管理员外，其他用户将无法登录，并且活跃非管理员会话会自动退出。' : '系统维护已关闭，恢复正常访问。');
                      } catch (err) {
                        console.error('Failed to change maintenance mode status:', err);
                        alert('操作失败，请重试');
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      maintenanceMode ? 'bg-red-600 animate-pulse' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        maintenanceMode ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
              
              <div className="p-6 border-b border-gray-200 bg-white">
                <h3 className="font-bold text-gray-800 mb-4">新建账号</h3>
                <form onSubmit={handleCreateUser} className="flex flex-wrap gap-4 items-end">
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs text-gray-500 mb-1">用户名</label>
                    <input type="text" required className="theme-input w-full" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="如: zhangsan" />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs text-gray-500 mb-1">密码 (至少6位)</label>
                    <input type="text" required className="theme-input w-full" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} placeholder="设置初始密码" />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs text-gray-500 mb-1">角色</label>
                    <select className="theme-input w-full" value={newRole} onChange={e => setNewRole(e.target.value)}>
                      <option value="销售">销售</option>
                      <option value="财务">财务</option>
                      <option value="助销">助销</option>
                      <option value="仓管">仓管</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium h-[38px] transition-colors">
                    创建账号
                  </button>
                </form>
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 font-medium">{t('用户名', 'Utilisateur')}</th>
                      <th className="px-6 py-4 font-medium">{t('注册时间', 'Date d\'inscription')}</th>
                      <th className="px-6 py-4 font-medium">{t('密码', 'Mot de passe')}</th>
                      <th className="px-6 py-4 font-medium">{t('当前角色', 'Rôle Actuel')}</th>
                      <th className="px-6 py-4 font-medium text-right">{t('操作', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900">{user.username || user.name || user.email?.split('@')[0]}</td>
                        <td className="px-6 py-4 text-gray-500">
                          {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleString() : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              placeholder="修改密码"
                              className="bg-white border border-gray-300 text-gray-900 text-xs rounded-lg p-1.5 w-32 hover:border-blue-400 focus:border-blue-500 focus:outline-none font-mono"
                              value={editedPasswords[user.id] !== undefined ? editedPasswords[user.id] : (user.password || '')}
                              onChange={(e) => {
                                setEditedPasswords({
                                  ...editedPasswords,
                                  [user.id]: e.target.value
                                });
                              }}
                            />
                            {editedPasswords[user.id] !== undefined && editedPasswords[user.id] !== (user.password || '') && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const newVal = editedPasswords[user.id].trim();
                                  if (!newVal) {
                                    alert(isFrench ? 'Le mot de passe ne peut pas être vide' : '密码不可为空');
                                    return;
                                  }
                                  if (newVal.length < 6) {
                                    alert(isFrench ? 'Le mot de passe doit contenir au moins 6 caractères' : '密码长度至少为 6 位');
                                    return;
                                  }
                                  try {
                                    await updateDoc(doc(db, 'users', user.id), { password: newVal });
                                    const updated = { ...editedPasswords };
                                    delete updated[user.id];
                                    setEditedPasswords(updated);
                                    alert(isFrench ? 'Mot de passe mis à jour avec succès' : '密码修改成功');
                                  } catch (err) {
                                    console.error('Failed to update password', err);
                                    alert(isFrench ? 'Échec de la modification, veuillez réessayer' : '修改密码失败，请重试');
                                  }
                                }}
                                className="bg-green-100 hover:bg-green-200 text-green-700 p-1 rounded-md transition-all flex items-center justify-center shrink-0"
                                title={isFrench ? 'Confirmer' : '确认'}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === 'admin' ? 'bg-red-100 text-red-800' :
                            user.role === '销售' ? 'bg-blue-100 text-blue-800' :
                            user.role === '财务' ? 'bg-green-100 text-green-800' :
                            user.role === '助销' ? 'bg-purple-100 text-purple-800' :
                            user.role === '仓管' ? 'bg-orange-100 text-orange-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role === 'pending' ? '等待审核' : user.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end items-center gap-2">
                          <select
                            className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2"
                            value={user.role}
                            onChange={async (e) => {
                              try {
                                await updateDoc(doc(db, 'users', user.id), { role: e.target.value });
                              } catch (err) {
                                console.error('Failed to update role', err);
                                alert(isFrench ? 'Échec de la mise à jour' : '更新角色失败');
                              }
                            }}
                          >
                            <option value="pending">{t('等待审核', 'En attente')} (Pending)</option>
                            <option value="销售">{t('销售', 'Ventes')} (Sales)</option>
                            <option value="财务">{t('财务', 'Finance')} (Finance)</option>
                            <option value="助销">{t('助销', 'Assistant')} (Assistant)</option>
                            <option value="仓管">{t('仓管', 'Magasinier')} (Warehouse)</option>
                            <option value="admin">{t('管理员', 'Admin')} (Admin)</option>
                          </select>
                          <button
                            onClick={() => setDeleteUserConfirmId(user.id)}
                            className="text-red-500 hover:text-red-700 p-2"
                            title="删除用户"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile View Users */}
              <div className="sm:hidden divide-y divide-gray-100">
                {allUsers.map((user) => (
                  <div key={user.id} className="p-4 bg-white">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="font-bold text-gray-900">{user.username || user.name || user.email?.split('@')[0]}</div>
                        <div className="text-xs text-gray-400 mt-1">{user.createdAt?.toDate ? user.createdAt.toDate().toLocaleString() : '-'}</div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        user.role === 'admin' ? 'bg-red-100 text-red-800' :
                        user.role === '销售' ? 'bg-blue-100 text-blue-800' :
                        user.role === '财务' ? 'bg-green-100 text-green-800' :
                        user.role === '助销' ? 'bg-purple-100 text-purple-800' :
                        user.role === '仓管' ? 'bg-orange-100 text-orange-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {user.role}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 font-medium">密码:</span>
                      <div className="flex-1 flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="修改密码"
                          className="flex-1 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg p-1.5 focus:border-blue-500 focus:outline-none font-mono"
                          value={editedPasswords[user.id] !== undefined ? editedPasswords[user.id] : (user.password || '')}
                          onChange={(e) => {
                            setEditedPasswords({
                              ...editedPasswords,
                              [user.id]: e.target.value
                            });
                          }}
                        />
                        {editedPasswords[user.id] !== undefined && editedPasswords[user.id] !== (user.password || '') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const newVal = editedPasswords[user.id].trim();
                              if (!newVal) {
                                alert(isFrench ? 'Le mot de passe ne peut pas être vide' : '密码不可为空');
                                return;
                              }
                              if (newVal.length < 6) {
                                alert(isFrench ? 'Le mot de passe doit contenir au moins 6 caractères' : '密码长度至少为 6 位');
                                return;
                              }
                              try {
                                await updateDoc(doc(db, 'users', user.id), { password: newVal });
                                const updated = { ...editedPasswords };
                                delete updated[user.id];
                                setEditedPasswords(updated);
                                alert(isFrench ? 'Mot de passe mis à jour avec succès' : '密码修改成功');
                              } catch (err) {
                                console.error('Failed to update password', err);
                                alert(isFrench ? 'Échec de la modification, veuillez réessayer' : '修改密码失败，请重试');
                              }
                            }}
                            className="bg-green-100 hover:bg-green-200 text-green-700 p-1 rounded-md transition-all flex items-center justify-center shrink-0"
                            title={isFrench ? 'Confirmer' : '确认'}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 items-center">
                      <select
                        className="flex-1 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg p-2"
                        value={user.role}
                        onChange={async (e) => {
                          try {
                            await updateDoc(doc(db, 'users', user.id), { role: e.target.value });
                          } catch (err) {
                            console.error('Failed to update role', err);
                            alert(isFrench ? 'Échec de la mise à jour' : '更新角色失败');
                          }
                        }}
                      >
                        <option value="pending">{t('等待审核', 'En attente')}</option>
                        <option value="销售">{t('销售', 'Ventes')}</option>
                        <option value="财务">{t('财务', 'Finance')}</option>
                        <option value="助销">{t('助销', 'Assistant')}</option>
                        <option value="仓管">{t('仓管', 'Magasinier')}</option>
                        <option value="admin">{t('管理员', 'Admin')}</option>
                      </select>
                      <button
                        onClick={() => setDeleteUserConfirmId(user.id)}
                        className="p-2 text-red-500 bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Spacer for mobile bottom nav */}
        <div className="h-[200px] sm:hidden" />
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{isHardDelete ? '确认彻底删除' : '确认作废'}</h3>
            <p className="text-gray-600 mb-6">
              {isHardDelete 
                ? '您确定要彻底删除这个订单吗？此操作将从数据库中永久抹除该订单及其所有记录，不可恢复！' 
                : '您确定要作废这个订单吗？作废后订单将不再显示在主列表中，但操作记录将被保留。'}
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => { setDeleteConfirmId(null); setIsHardDelete(false); }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={async () => {
                  try {
                    if (isHardDelete) {
                      await deleteDoc(doc(db, 'orders', deleteConfirmId));
                      setSuccessMsg('订单已从后台数据库彻底移除');
                    } else {
                      const orderToSoftDelete = orders.find(o => o._docId === deleteConfirmId);
                      if (!orderToSoftDelete) return;

                      const now = new Date();
                      const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                      const displayName = userName || currentUser?.email?.split('@')[0] || 'Unknown';
                      const logEntry = `[系统日志 ${timestamp} ${displayName}]: 作废了该订单`;
                      
                      const updatedRemarks = orderToSoftDelete.remarks 
                        ? `${logEntry}\n${orderToSoftDelete.remarks}` 
                        : logEntry;

                      await updateDoc(doc(db, 'orders', deleteConfirmId), { 
                        status: '已作废',
                        remarks: updatedRemarks,
                        updatedAt: serverTimestamp()
                      });
                      setSuccessMsg('订单已成功作废并保留记录');
                    }
                    
                    setDeleteConfirmId(null);
                    setIsHardDelete(false);
                    if (viewingOrder?._docId === deleteConfirmId) {
                      setViewingOrder(null);
                      setCurrentView('list');
                    }
                  } catch (err) {
                    console.error('Failed to complete delete/soft-delete operation', err);
                    alert('操作失败');
                  }
                }}
                className={`px-4 py-2 ${isHardDelete ? 'bg-black hover:bg-red-900' : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg transition-colors`}
              >
                {isHardDelete ? '确认彻底删除' : '确认作废'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteUserConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-2">确认删除用户</h3>
            <p className="text-gray-600 mb-6">您确定要删除该用户吗？删除后该用户将立即失去所有权限，此操作不可恢复。</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setDeleteUserConfirmId(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={async () => {
                  try {
                    await deleteDoc(doc(db, 'users', deleteUserConfirmId));
                    setDeleteUserConfirmId(null);
                  } catch (err: any) {
                    console.error('Failed to delete user', err);
                    // Fallback to console error since alert is blocked
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inventory Warning Modal */}
      {inventoryWarningItems && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-lg max-w-lg w-full flex flex-col max-h-[85vh]">
            <h3 className="text-lg font-bold text-red-600 mb-2 flex items-center gap-2">
              ⚠️ {isFrench ? 'Alerte Stock Insuffisant' : '库存不足警告'}
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              {isFrench 
                ? 'Les articles suivants ont un stock disponible inférieur à la quantité demandée :' 
                : '以下商品的可用量不足以满足当前的订单需求：'}
            </p>
            
            <div className="flex-1 overflow-y-auto mb-6 border border-gray-100 rounded-lg p-3 bg-red-50/50">
              <table className="w-full text-left font-sans text-sm">
                <thead>
                  <tr className="border-b border-red-100 text-gray-500 font-medium font-bold">
                    <th className="pb-2">{isFrench ? 'Article' : '商品名称'}</th>
                    <th className="pb-2 text-right">{isFrench ? 'Requis' : '需求数'}</th>
                    <th className="pb-2 text-right">{isFrench ? 'Dispo' : '可用量'}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryWarningItems.map((it, idx) => (
                    <tr key={idx} className="border-b border-red-50/50 text-red-900">
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold">{it.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{it.color} / {it.spec}</div>
                      </td>
                      <td className="py-2.5 text-right font-semibold">{it.requested}</td>
                      <td className="py-2.5 text-right font-semibold text-red-600">{it.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-sm font-semibold text-gray-700 mb-6">
              {isFrench 
                ? 'Veuillez modifier le nombre d\'articles pour respecter la limite du stock disponible, puis soumettez à nouveau.' 
                : '请修改商品数量以满足可用库存要求，调整后方可重新提交订单。'}
            </p>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setInventoryWarningItems(null)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-semibold"
              >
                {isFrench ? 'Retourner pour modifier' : '返回修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Modal */}
      {/* Notification Toasts */}
      <div className="fixed top-4 right-4 sm:right-4 left-4 sm:left-auto z-[9999] flex flex-col gap-2 pointer-events-none">
        {notifications.map(n => (
          <div 
            key={n.id} 
            onClick={() => {
              if (n.orderDocId) {
                const targetOrder = orders.find((o: any) => o._docId === n.orderDocId);
                if (targetOrder) {
                  setViewingOrder(targetOrder);
                  setCurrentView('detail');
                  setNotifications(prev => prev.filter(item => item.id !== n.id));
                }
              }
            }}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-toast-in w-full sm:w-80 transition-transform hover:scale-105 active:scale-95 ${n.orderDocId ? 'cursor-pointer' : ''} ${
              n.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
              n.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
              'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {n.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-500" /> :
             n.type === 'warning' ? <AlertCircle className="w-5 h-5 flex-shrink-0 text-yellow-500" /> :
             <AlertCircle className="w-5 h-5 flex-shrink-0 text-blue-500" />}
            <span className="font-medium text-sm flex-grow">{n.message}</span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setNotifications(prev => prev.filter(item => item.id !== n.id));
              }}
              className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {zoomedImage && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out'
          }}
          onClick={() => setZoomedImage(null)}
        >
          <img 
            src={zoomedImage} 
            alt="大图预览" 
            style={{maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'}}
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Change Password Modal */}
      {isChangingPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-4">修改我的密码</h3>
            <form onSubmit={handleChangePassword}>
              {passwordMessage.text && (
                <div className={`p-3 rounded-lg text-sm mb-4 ${passwordMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                  {passwordMessage.text}
                </div>
              )}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">原密码</label>
                <input
                  type="password"
                  required
                  className="theme-input w-full"
                  value={oldSelfPassword}
                  onChange={e => setOldSelfPassword(e.target.value)}
                  placeholder="请输入当前密码"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码 (至少6位)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  className="theme-input w-full"
                  value={newSelfPassword}
                  onChange={e => setNewSelfPassword(e.target.value)}
                  placeholder="请输入新密码"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsChangingPassword(false); setPasswordMessage({type:'', text:''}); setOldSelfPassword(''); setNewSelfPassword(''); }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  确认修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Image Modal */}
      {imageModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-[99991] p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-4 sm:p-6 max-w-lg w-full shadow-2xl relative border border-gray-100 flex flex-col my-auto max-h-[95vh]">
            {/* Close Button */}
            <button 
              onClick={() => {
                if (imageModal.url) {
                  URL.revokeObjectURL(imageModal.url);
                }
                setImageModal(prev => ({ ...prev, isOpen: false }));
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header Icon & Title */}
            <div className="flex items-center gap-3 mb-3 pr-8">
              <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                  {t("订单图片已生成", "Image de Commande Générée")}
                </h3>
                <p className="text-xs text-gray-500 truncate">
                  {imageModal.filename}
                </p>
              </div>
            </div>

            {/* Scrollable Image Preview */}
            <div className="w-full bg-gray-100 rounded-xl border border-gray-200 overflow-y-auto max-h-[48vh] sm:max-h-[52vh] flex items-center justify-center p-2 mb-4 shadow-inner">
              <img 
                src={imageModal.url} 
                alt="Bon de Commande" 
                className="w-full h-auto object-contain rounded shadow-sm"
              />
            </div>

            {/* Mobile / WeChat Long Press Notice */}
            <div className="bg-amber-50/90 border border-amber-200 text-amber-900 px-3 py-2 rounded-xl text-xs mb-3 flex items-start gap-2">
              <span className="text-sm shrink-0">💡</span>
              <div className="leading-snug">
                <span className="font-semibold">{t("保存与分享小贴士：", "Conseil de partage : ")}</span>
                {t("手机端可直接", "Sur mobile, vous pouvez ")}
                <span className="font-bold underline text-amber-950">{t("长按上方图片", "maintenir l'image appuyée")}</span>
                {t("，弹出微信菜单快速【发送给朋友】或【保存到手机相册】。", " pour l'enregistrer ou l'envoyer.")}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {/* Native share option if supported on mobile/browser */}
              {navigator.canShare && imageModal.blob && (
                <button
                  onClick={async () => {
                    if (imageModal.blob) {
                      const file = new File([imageModal.blob], imageModal.filename, { type: 'image/png' });
                      try {
                        await navigator.share({
                          files: [file],
                          title: imageModal.filename,
                          text: 'Bon de commande'
                        });
                      } catch (err) {
                        console.error('Manual Web Share failed:', err);
                      }
                    }
                  }}
                  className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100 transition-all sm:col-span-2"
                >
                  <Share2 className="w-4 h-4" />
                  {t("一键系统分享 (微信/WhatsApp)", "Partager (WeChat / WhatsApp)")}
                </button>
              )}

              {/* Copy Image to Clipboard (Desktop) */}
              <button
                onClick={handleCopyImageToClipboard}
                className={`py-2.5 px-3 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 border transition-all ${
                  imageModal.copied 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                }`}
              >
                {imageModal.copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{t("已复制到剪贴板", "Image Copiée !")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-gray-500" />
                    <span>{t("复制图片到剪贴板", "Copier l'image")}</span>
                  </>
                )}
              </button>

              {/* Direct Download fallback */}
              <a
                href={imageModal.url}
                download={imageModal.filename}
                className="py-2.5 px-3 bg-white hover:bg-gray-50 text-gray-700 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 border border-gray-200 transition-all text-center"
              >
                <Download className="w-4 h-4 text-gray-500" />
                {t("保存/下载图片 (PNG)", "Télécharger (PNG)")}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Order PDF Modal */}
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
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header Icon & Title */}
            <div className="flex items-center gap-3 mb-4 pr-8">
              <div className="bg-rose-50 text-rose-600 p-2.5 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                  {t("法语版 PDF 已生成", "PDF de Commande Généré")}
                </h3>
                <p className="text-xs text-gray-500 truncate">
                  {mobilePdfModal.filename}
                </p>
              </div>
            </div>

            {/* PDF Info Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-center">
              <FileText className="w-12 h-12 text-rose-500 mx-auto mb-2 opacity-80" />
              <div className="font-semibold text-sm text-gray-800 break-all mb-1">
                {mobilePdfModal.filename}
              </div>
              <div className="text-xs text-gray-500">
                {t("格式: PDF 电子文档 (适合正式打印与归档)", "Format: Document PDF officiel")}
              </div>
            </div>

            {/* WeChat Tip */}
            {/MicroMessenger/i.test(navigator.userAgent) && (
              <div className="bg-amber-50/90 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-xl text-xs mb-4 flex items-start gap-2">
                <span className="text-sm shrink-0">💡</span>
                <div className="leading-snug">
                  <span className="font-semibold">{t("微信提示：", "Note WeChat : ")}</span>
                  {t("若在微信中无法直接下载，可点击右上角【···】选择【在浏览器中打开】即可正常下载或发送。", "Si le téléchargement est bloqué dans WeChat, cliquez sur [···] puis 'Ouvrir dans le navigateur'.")}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5">
              {/* Native share option */}
              {navigator.canShare && mobilePdfModal.blob && (
                <button
                  onClick={async () => {
                    if (mobilePdfModal.blob) {
                      const file = new File([mobilePdfModal.blob], mobilePdfModal.filename, { type: 'application/pdf' });
                      try {
                        await navigator.share({
                          files: [file],
                          title: mobilePdfModal.filename,
                          text: `Bon de commande - ${viewingOrder?.customer?.['客户名'] || ''}`
                        });
                      } catch (err) {
                        console.error('Manual Web Share failed:', err);
                      }
                    }
                  }}
                  className="w-full py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-rose-100 transition-all"
                >
                  <Share2 className="w-4 h-4" />
                  {t("一键系统分享 (微信/WhatsApp)", "Partager (WeChat / WhatsApp)")}
                </button>
              )}

              {/* Direct Open Preview in New Tab */}
              <a
                href={mobilePdfModal.url}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all text-center"
              >
                <Eye className="w-4 h-4 text-gray-600" />
                {t("在线预览 PDF", "Visualiser le PDF")}
              </a>

              {/* Direct Download */}
              <a
                href={mobilePdfModal.url}
                download={mobilePdfModal.filename}
                className="w-full py-2.5 px-3 bg-white hover:bg-gray-50 text-gray-700 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 border border-gray-200 transition-all text-center"
              >
                <Download className="w-4 h-4 text-gray-500" />
                {t("下载保存 PDF 文件", "Télécharger le PDF")}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

