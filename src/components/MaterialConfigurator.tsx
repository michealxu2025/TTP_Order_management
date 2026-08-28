import React, { useState, useEffect, useMemo } from 'react';

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

interface Props {
  key?: string | number;
  materialCode: string;
  customerLevel: string;
  inventory: InventoryItem[];
  prices: PriceItem[];
  initialItems?: OrderItem[];
  onItemsChange: (materialCode: string, items: OrderItem[]) => void;
  onZoomImage: (url: string) => void;
  translateColor?: (color: string) => string;
  isFrench?: boolean;
  todayConsumption?: Record<string, number>;
  compact?: boolean;
}

export default function MaterialConfigurator({
  materialCode,
  customerLevel,
  inventory,
  prices,
  initialItems = [],
  onItemsChange,
  onZoomImage,
  translateColor,
  isFrench,
  todayConsumption = {},
  compact = false
}: Props) {
  const [totalQuantity, setTotalQuantity] = useState<number | ''>('');
  const [manualQuantities, setManualQuantities] = useState<Record<string, number>>({});
  const [manualUnitPrice, setManualUnitPrice] = useState<number | ''>('');
  const [isExpanded, setIsExpanded] = useState(false);

  const getRealTimeStockCount = (c: InventoryItem) => {
    const code = (c[' 物料编码 '] || (c as any)['物料编码'] || '').trim();
    const base = Number(c['可用量']) || 0;
    const consumed = todayConsumption[code] || 0;
    return Math.max(0, base - consumed);
  };

  // Initialize from initialItems
  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      let total = 0;
      const manuals: Record<string, number> = {};
      
      // We need to map color to invKey
      // But we don't have availableColors computed yet in this effect scope easily,
      // so we can just do it when availableColors is ready.
    }
  }, []);

  const selectedMaterialPrice = useMemo(() => 
    prices.find(p => String(p['物料代码']).trim() === String(materialCode).trim()),
  [prices, materialCode]);

  useEffect(() => {
    if (!selectedMaterialPrice) {
      setManualUnitPrice('');
      return;
    }
    const levelKey = `${customerLevel}级单价` as keyof PriceItem;
    const priceStr = selectedMaterialPrice[levelKey] || '0';
    const price = parseFloat(priceStr.replace(/[^0-9.-]+/g, ''));
    setManualUnitPrice(price);
  }, [selectedMaterialPrice, customerLevel]);

  const availableColors = useMemo(() => {
    if (!materialCode || !selectedMaterialPrice) return [];
    const selectedName = selectedMaterialPrice['物料名称']?.trim();
    if (!selectedName) return [];
    return inventory.filter(i => i['物料名称']?.trim() === selectedName);
  }, [inventory, materialCode, selectedMaterialPrice]);

  const getInvKey = (c: InventoryItem, idx: number) => {
    const code = c[' 物料编码 '] || (c as any)['物料编码'];
    return code ? String(code).trim() : `idx-${idx}`;
  };

  // Initialize from initialItems once availableColors is ready
  useEffect(() => {
    if (initialItems && initialItems.length > 0 && availableColors.length > 0) {
      let total = 0;
      const manuals: Record<string, number> = {};
      
      initialItems.forEach(item => {
        total += item.quantity;
        // Find corresponding inventory item to get the key
        const idx = availableColors.findIndex(c => c['颜色'] === item.color);
        if (idx !== -1) {
          const key = getInvKey(availableColors[idx], idx);
          manuals[key] = item.quantity;
        }
      });
      
      setTotalQuantity(total);
      setManualQuantities(manuals);
      if (initialItems[0].unitPrice !== undefined) {
        setManualUnitPrice(initialItems[0].unitPrice);
      }
    }
  }, [availableColors]); // Run when availableColors are ready

  const totalAvailable = useMemo(() => {
    return availableColors.reduce((sum, c) => sum + getRealTimeStockCount(c), 0);
  }, [availableColors, todayConsumption]);

  const itemQuantities = useMemo(() => {
    const result: Record<string, number> = {};
    if (!totalQuantity || totalQuantity <= 0) return result;
    
    let manualSum = 0;
    for (const key in manualQuantities) {
      result[key] = manualQuantities[key];
      manualSum += manualQuantities[key];
    }
    
    let remaining = Number(totalQuantity) - manualSum;
    
    const itemsWithKeys = availableColors.map((c, idx) => ({
      ...c,
      _key: getInvKey(c, idx),
      _max: getRealTimeStockCount(c)
    }));

    const activeItems = itemsWithKeys.filter(c => !(c._key in manualQuantities) && c._max > 0);
    
    activeItems.forEach(c => { result[c._key] = 0; });
    
    while (remaining > 0 && activeItems.length > 0) {
      const share = Math.floor(remaining / activeItems.length);
      let distributedThisRound = 0;
      
      if (share > 0) {
        for (let i = activeItems.length - 1; i >= 0; i--) {
          const c = activeItems[i];
          const current = result[c._key];
          const toAdd = Math.min(share, c._max - current);
          
          result[c._key] += toAdd;
          remaining -= toAdd;
          distributedThisRound += toAdd;
          
          if (result[c._key] >= c._max) {
            activeItems.splice(i, 1);
          }
        }
      } else {
        for (let i = 0; i < activeItems.length && remaining > 0; i++) {
          const c = activeItems[i];
          const current = result[c._key];
          
          if (current < c._max) {
            result[c._key] += 1;
            remaining -= 1;
            distributedThisRound += 1;
            
            if (result[c._key] >= c._max) {
              activeItems.splice(i, 1);
              i--;
            }
          }
        }
      }
      if (distributedThisRound === 0) break;
    }
    return result;
  }, [totalQuantity, manualQuantities, availableColors, todayConsumption]);

  const handleManualQuantityChange = (key: string, value: string, maxAvailable: number) => {
    if (value !== '') {
      let numValue = Number(value);
      if (numValue > maxAvailable) return; // Prevent input if greater than available
    }
    const newManual = { ...manualQuantities };
    if (value === '') {
      delete newManual[key];
    } else {
      let numValue = Number(value);
      if (numValue < 0) numValue = 0;
      newManual[key] = numValue;
    }
    setManualQuantities(newManual);
  };

  const getFrenchName = (p: PriceItem | undefined) => {
    if (!p) return '';
    // 强制采用 B 列（物料代码）作为第一优先级法语名称
    return p['物料代码'] || p['法语名'] || p['法语名称'] || p['法语'] || p['Désignation'] || p['Designation'] || p['Nom du produit'] || p['Description'] || '';
  };

  useEffect(() => {
    const newItems: OrderItem[] = [];
    availableColors.forEach((c, idx) => {
      const key = getInvKey(c, idx);
      const qty = itemQuantities[key] || 0;
      if (qty > 0) {
        const unitPrice = Number(manualUnitPrice);
        const nameFr = getFrenchName(selectedMaterialPrice);
        newItems.push({
          id: `${materialCode}-${key}`,
          materialCode: materialCode,
          inventoryCode: (c[' 物料编码 '] || (c as any)['物料编码'] || '').trim() || '-',
          specification: c['规格型号'] || '-',
          materialName: isFrench && nameFr ? nameFr : (selectedMaterialPrice?.['物料名称'] || ''),
          color: c['颜色'],
          quantity: qty,
          unitPrice: unitPrice,
          totalPrice: unitPrice * qty
        });
      }
    });
    onItemsChange(materialCode, newItems);
  }, [itemQuantities, manualUnitPrice, availableColors, materialCode, selectedMaterialPrice, onItemsChange, isFrench]);

  if (!selectedMaterialPrice) return null;

  if (compact) {
    const isActive = (totalQuantity !== '' && totalQuantity > 0);
    return (
      <div 
        style={{
          border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px',
          background: isActive ? '#eff6ff' : 'white',
          transition: 'all 0.2s',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'relative',
          height: '100%',
          boxShadow: isActive ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : 'none'
        }}
      >
        <div style={{ width: '100%', aspectRatio: '1/1', background: '#f8fafc', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {selectedMaterialPrice['图片'] ? (
            <img 
              src={selectedMaterialPrice['图片']} 
              alt={selectedMaterialPrice['物料名称']} 
              style={{width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in'}} 
              referrerPolicy="no-referrer" 
              onClick={() => onZoomImage(selectedMaterialPrice['图片'])}
            />
          ) : (
            <span style={{fontSize: '0.6rem', color: '#94a3b8'}}>{isFrench ? 'Pas d\'image' : '无图片'}</span>
          )}
          <div style={{position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(255,255,255,0.9)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', color: totalAvailable < 100 ? '#ef4444' : 'var(--accent)'}}>
            {totalAvailable} {isFrench ? 'Disp' : '库存'}
          </div>
        </div>

        <div style={{fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: '1.2', height: '2.4em', overflow: 'hidden'}}>
          {isFrench && getFrenchName(selectedMaterialPrice) ? getFrenchName(selectedMaterialPrice) : selectedMaterialPrice['物料名称']}
        </div>

        {/* Customer Level Price Display placed between Image/Name and Total input */}
        <div style={{
          textAlign: 'center',
          fontSize: '0.85rem',
          fontWeight: 'bold',
          color: 'var(--primary)',
          fontFamily: 'monospace',
          background: '#f8fafc',
          padding: '4px 8px',
          borderRadius: '6px',
          border: '1px dashed #e2e8f0'
        }}>
          CFA {manualUnitPrice !== '' ? Number(manualUnitPrice).toLocaleString() : '-'}
        </div>
        
        {/* Total Input Area */}
        <div style={{marginTop: 'auto'}}>
          <div style={{display: 'flex', gap: '4px', alignItems: 'center'}}>
            <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>{isFrench ? 'Qté' : '总量'}:</span>
            <input 
              type="number"
              min="0"
              max={totalAvailable}
              className="theme-input no-spin"
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                borderColor: isActive ? 'var(--primary)' : 'var(--border)',
                textAlign: 'center'
              }}
              value={totalQuantity}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : '';
                if (val !== '' && val > totalAvailable) return;
                setTotalQuantity(val);
                setManualQuantities({});
              }}
              placeholder="0"
            />
          </div>

          {isActive && (
            <div style={{marginTop: '8px', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '8px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span className="text-[10px] text-gray-500 font-medium">
                  {isFrench ? 'Ajuster les couleurs' : '调整颜色'}
                </span>
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--primary)',
                    color: 'white',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                >
                  {isExpanded ? (isFrench ? 'Fermer' : '折叠') : (isFrench ? 'Détails' : '详情')}
                </button>
              </div>

              {isExpanded && (
                <div style={{
                  marginTop: '8px', 
                  maxHeight: '200px', 
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'white',
                  padding: '4px'
                }}>
                  {availableColors.map((c, idx) => {
                    const key = getInvKey(c, idx);
                    const realAvailable = getRealTimeStockCount(c);
                    const qty = itemQuantities[key] || '';
                    const isManual = key in manualQuantities;
                    if (realAvailable <= 0 && qty <= 0) return null;
                    return (
                      <div key={key} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px', borderBottom: '1px solid #f1f5f9', fontSize: '0.7rem'}}>
                        <span style={{flex: 1}}>{translateColor ? translateColor(c['颜色']) : c['颜色']}</span>
                        <span style={{color: '#94a3b8', fontSize: '0.65rem', marginRight: '8px'}}>({realAvailable})</span>
                        <input 
                          type="number"
                          min="0"
                          max={realAvailable}
                          style={{
                            width: '45px',
                            padding: '2px',
                            border: '1px solid',
                            borderColor: isManual ? 'var(--primary)' : '#e2e8f0',
                            borderRadius: '2px',
                            textAlign: 'center',
                            fontSize: '0.7rem'
                          }}
                          value={qty}
                          onChange={(e) => handleManualQuantityChange(key, e.target.value, realAvailable)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '16px', background: 'white'}}>
      <div className="product-grid">
        <div className="product-img">
          {selectedMaterialPrice['图片'] ? (
            <img 
              src={selectedMaterialPrice['图片']} 
              alt="物料图片" 
              referrerPolicy="no-referrer" 
              style={{cursor: 'zoom-in'}}
              onClick={() => onZoomImage(selectedMaterialPrice['图片'])}
            />
          ) : '[暂无图片]'}
        </div>
        <div>
          <div className="info-label" style={{fontSize: '0.7rem'}}>{isFrench ? `Tarification (${customerLevel})` : `当前级别定价 (${customerLevel}级)`}</div>
          <div className="price-tag" style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
            CFA 
            <input 
              type="number" 
              className="theme-input" 
              style={{padding: '2px 6px', fontSize: '1.2rem', width: '120px', fontWeight: 'bold', color: 'var(--primary)'}} 
              value={manualUnitPrice} 
              onChange={(e) => setManualUnitPrice(e.target.value ? Number(e.target.value) : '')} 
            />
          </div>
          <div className="info-label" style={{marginTop: '8px', fontSize: '0.7rem'}}>{isFrench ? 'Produit' : '物料名称'}: {isFrench && getFrenchName(selectedMaterialPrice) ? getFrenchName(selectedMaterialPrice) : selectedMaterialPrice['物料名称']}</div>
          <div className="info-label" style={{marginTop: '4px', fontSize: '0.7rem'}}>{isFrench ? 'Stock Total' : '库存总数'}: {totalAvailable}</div>
          <div className="info-label" style={{marginTop: '4px', fontSize: '0.7rem'}}>{isFrench ? 'Code' : '物料编码'}: {materialCode}</div>
          <div style={{marginTop: '8px'}}>
            <input 
              type="number" 
              min="0"
              max={totalAvailable}
              className="theme-input no-spin"
              style={{padding: '6px', fontSize: '0.8rem'}}
              value={totalQuantity}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : '';
                if (val !== '' && val > totalAvailable) return; // Prevent input if greater than total available
                setTotalQuantity(val);
                setManualQuantities({});
              }}
              placeholder={isFrench ? 'Quantité totale' : '输入该物料总数量'}
            />
          </div>
        </div>
      </div>

      <div style={{marginTop: '10px'}}>
        <div className="info-label" style={{marginBottom: '12px', fontWeight: 'bold'}}>{isFrench ? 'Répartition des quantités par couleur' : '颜色数量分配'}</div>
        
        {/* Desktop View Table */}
        <div className="hidden sm:block">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>{isFrench ? 'Couleur' : '颜色'}</th>
                <th>{isFrench ? 'Disponible' : '可用量'}</th>
                <th>{isFrench ? 'Code Inv' : '物料编码'}</th>
                <th>{isFrench ? 'Spec' : '规格型号'}</th>
                <th>{isFrench ? 'Allocation' : '分配数量'}</th>
              </tr>
            </thead>
            <tbody>
              {availableColors.map((c, idx) => {
                const key = getInvKey(c, idx);
                const realAvailable = getRealTimeStockCount(c);
                const isOutOfStock = realAvailable <= 0;
                const qty = itemQuantities[key] || '';
                const isManual = key in manualQuantities;
                const invCode = (c[' 物料编码 '] || (c as any)['物料编码'] || '').trim() || '-';
                const spec = c['规格型号'] || '-';
                const isFullyAllocated = qty !== '' && Number(qty) === realAvailable;
                return (
                  <tr key={key} style={isOutOfStock ? {color: '#ef4444'} : {}}>
                    <td>{translateColor ? translateColor(c['颜色']) : c['颜色']}</td>
                    <td style={isFullyAllocated ? {color: '#ef4444', fontWeight: 'bold'} : {}}>{realAvailable}</td>
                    <td style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>{invCode}</td>
                    <td style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>{spec}</td>
                    <td>
                      <input 
                        type="number"
                        min="0"
                        max={realAvailable}
                        className="theme-input"
                        style={{
                          width: '80px', 
                          padding: '4px', 
                          borderColor: isManual ? 'var(--primary)' : 'var(--border)',
                          backgroundColor: isManual ? '#eff6ff' : 'white'
                        }}
                        value={qty}
                        onChange={(e) => handleManualQuantityChange(key, e.target.value, realAvailable)}
                        disabled={isOutOfStock}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="sm:hidden grid grid-cols-1 gap-3">
          {availableColors.map((c, idx) => {
            const key = getInvKey(c, idx);
            const realAvailable = getRealTimeStockCount(c);
            const isOutOfStock = realAvailable <= 0;
            const qty = itemQuantities[key] || '';
            const isManual = key in manualQuantities;
            const invCode = (c[' 物料编码 '] || (c as any)['物料编码'] || '').trim() || '-';
            const spec = c['规格型号'] || '-';
            const isFullyAllocated = qty !== '' && Number(qty) === realAvailable;
            
            return (
              <div key={key} className={`p-3 rounded-lg border ${isManual ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-white'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-bold text-gray-900">{translateColor ? translateColor(c['颜色']) : c['颜色']}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{invCode} | {spec}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-gray-400 uppercase leading-none mb-1">{isFrench ? 'Dispo' : '可用'}</div>
                    <div className={`text-sm font-bold ${isOutOfStock ? 'text-red-500' : isFullyAllocated ? 'text-red-600' : 'text-gray-700'}`}>
                      {realAvailable}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-xs text-gray-500 font-medium">{isFrench ? 'Saisir' : '分配数量'}:</div>
                  <input 
                    type="number"
                    min="0"
                    max={realAvailable}
                    className="theme-input text-center h-10 w-24"
                    value={qty}
                    onChange={(e) => handleManualQuantityChange(key, e.target.value, realAvailable)}
                    disabled={isOutOfStock}
                    placeholder="0"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
