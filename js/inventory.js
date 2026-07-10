/**
 * 背包系统 - 物品管理和UI
 * 支持物品堆叠、快捷栏、背包界面
 */
import { ItemType, ItemDefs, WeaponDefs } from './combat.js';

// ==================== 物品槽 ====================

/**
 * 物品槽类
 */
export class ItemSlot {
  constructor() {
    this.itemId = null;
    this.count = 0;
  }
  
  /**
   * 设置物品
   */
  set(itemId, count = 1) {
    this.itemId = itemId;
    this.count = count;
  }
  
  /**
   * 清空物品槽
   */
  clear() {
    this.itemId = null;
    this.count = 0;
  }
  
  /**
   * 是否为空
   */
  isEmpty() {
    return !this.itemId || this.count <= 0;
  }
  
  /**
   * 添加物品
   */
  add(itemId, count = 1) {
    const def = ItemDefs[itemId];
    if (!def) return 0;
    
    const maxStack = def.stackable ? def.maxStack : 1;
    
    if (this.itemId === itemId && def.stackable) {
      const canAdd = Math.min(count, maxStack - this.count);
      this.count += canAdd;
      return canAdd;
    } else if (this.isEmpty()) {
      const toAdd = Math.min(count, maxStack);
      this.set(itemId, toAdd);
      return toAdd;
    }
    
    return 0;
  }
  
  /**
   * 移除物品
   */
  remove(count = 1) {
    const removed = Math.min(count, this.count);
    this.count -= removed;
    if (this.count <= 0) {
      this.clear();
    }
    return removed;
  }
  
  /**
   * 获取物品定义
   */
  getDef() {
    return this.itemId ? ItemDefs[this.itemId] : null;
  }
  
  /**
   * 获取武器定义
   */
  getWeaponDef() {
    const def = this.getDef();
    if (def && def.type === ItemType.WEAPON) {
      return WeaponDefs[def.weaponType];
    }
    return null;
  }
}

// ==================== 背包类 ====================

/**
 * 背包类
 */
export class Inventory {
  constructor() {
    // 快捷栏 (9格)
    this.hotbar = Array.from({ length: 9 }, () => new ItemSlot());
    
    // 背包 (27格 = 3行 x 9列)
    this.slots = Array.from({ length: 27 }, () => new ItemSlot());
    
    // 当前选中的快捷栏索引
    this.selectedSlot = 0;
    
    // 背包是否打开
    this.isOpen = false;
    
    // 初始化默认物品
    this._initDefaultItems();
  }
  
  /**
   * 初始化默认物品
   */
  _initDefaultItems() {
    // 快捷栏默认物品
    this.hotbar[0].set('iron_sword');
    this.hotbar[1].set('pistol');
    this.hotbar[2].set('bow');
    this.hotbar[3].set('bullet', 12);
    this.hotbar[4].set('arrow', 32);
    this.hotbar[5].set('health_potion', 3);
    this.hotbar[6].set('war_axe');
  }
  
  /**
   * 获取当前选中的物品
   */
  getSelectedItem() {
    return this.hotbar[this.selectedSlot];
  }
  
  /**
   * 获取当前武器
   */
  getCurrentWeapon() {
    const slot = this.getSelectedItem();
    if (slot.isEmpty()) return null;
    
    const def = slot.getDef();
    if (def && def.type === ItemType.WEAPON) {
      return {
        id: slot.itemId,
        def: def,
        weaponDef: WeaponDefs[def.weaponType],
        slot: slot,
      };
    }
    return null;
  }
  
  /**
   * 添加物品
   */
  addItem(itemId, count = 1) {
    const def = ItemDefs[itemId];
    if (!def) return 0;
    
    let remaining = count;
    
    // 先尝试堆叠到已有物品
    for (const slot of [...this.hotbar, ...this.slots]) {
      if (remaining <= 0) break;
      if (slot.itemId === itemId && def.stackable) {
        remaining -= slot.add(itemId, remaining);
      }
    }
    
    // 再尝试放入空槽
    if (remaining > 0) {
      for (const slot of [...this.hotbar, ...this.slots]) {
        if (remaining <= 0) break;
        if (slot.isEmpty()) {
          remaining -= slot.add(itemId, remaining);
        }
      }
    }
    
    return count - remaining;
  }
  
  /**
   * 移除物品
   */
  removeItem(itemId, count = 1) {
    let remaining = count;
    
    for (const slot of [...this.hotbar, ...this.slots]) {
      if (remaining <= 0) break;
      if (slot.itemId === itemId) {
        remaining -= slot.remove(remaining);
      }
    }
    
    return count - remaining;
  }
  
  /**
   * 计算物品数量
   */
  countItem(itemId) {
    let total = 0;
    for (const slot of [...this.hotbar, ...this.slots]) {
      if (slot.itemId === itemId) {
        total += slot.count;
      }
    }
    return total;
  }
  
  /**
   * 切换快捷栏
   */
  selectSlot(index) {
    if (index >= 0 && index < 9) {
      this.selectedSlot = index;
      return true;
    }
    return false;
  }
  
  /**
   * 切换背包开关
   */
  toggleInventory() {
    this.isOpen = !this.isOpen;
    return this.isOpen;
  }
  
  /**
   * 在槽之间移动物品
   */
  moveItem(fromIndex, toIndex, fromHotbar = true, toHotbar = true) {
    const fromSlots = fromHotbar ? this.hotbar : this.slots;
    const toSlots = toHotbar ? this.hotbar : this.slots;
    
    const from = fromSlots[fromIndex];
    const to = toSlots[toIndex];
    
    if (from.isEmpty()) return false;
    
    // 如果目标为空，直接移动
    if (to.isEmpty()) {
      to.set(from.itemId, from.count);
      from.clear();
      return true;
    }
    
    // 如果物品相同且可堆叠
    if (from.itemId === to.itemId) {
      const def = ItemDefs[from.itemId];
      if (def && def.stackable) {
        const canAdd = def.maxStack - to.count;
        const toMove = Math.min(from.count, canAdd);
        to.count += toMove;
        from.count -= toMove;
        if (from.count <= 0) from.clear();
        return true;
      }
    }
    
    // 交换物品
    const tempId = to.itemId;
    const tempCount = to.count;
    to.set(from.itemId, from.count);
    from.set(tempId, tempCount);
    return true;
  }
}

// ==================== 玩家状态 ====================

/**
 * 玩家状态
 */
export class PlayerStats {
  constructor() {
    this.maxHealth = 100;
    this.health = 100;
    this.maxArmor = 100;
    this.armor = 0;
    this.hunger = 20;
    this.maxHunger = 20;
  }
  
  /**
   * 受到伤害
   */
  takeDamage(damage) {
    // 先扣除护甲
    if (this.armor > 0) {
      const armorAbsorb = Math.min(damage * 0.5, this.armor);
      this.armor -= armorAbsorb;
      damage -= armorAbsorb;
    }
    
    this.health = Math.max(0, this.health - damage);
    return damage;
  }
  
  /**
   * 治疗
   */
  heal(amount) {
    const healed = Math.min(amount, this.maxHealth - this.health);
    this.health += healed;
    return healed;
  }
  
  /**
   * 是否死亡
   */
  isDead() {
    return this.health <= 0;
  }
  
  /**
   * 重置状态
   */
  reset() {
    this.health = this.maxHealth;
    this.armor = 0;
    this.hunger = this.maxHunger;
  }
}
