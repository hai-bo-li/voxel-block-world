/**
 * 战斗系统 - 武器、子弹、伤害
 * 支持近战武器和远程射击
 */
import * as THREE from 'three';
import { BlockType, isSolid } from './voxel.js';

// ==================== 武器定义 ====================

/**
 * 武器类型枚举
 */
export const WeaponType = {
  SWORD: 'sword',
  AXE: 'axe',
  BOW: 'bow',
  GUN: 'gun',
};

/**
 * 武器属性定义
 */
export const WeaponDefs = {
  [WeaponType.SWORD]: {
    name: '铁剑',
    type: 'melee',
    damage: 25,
    range: 3.5,
    fireRate: 2, // 每秒攻击次数
    knockback: 0.3,
    color: 0xcccccc,
    description: '锋利的铁剑，适合近战',
  },
  [WeaponType.AXE]: {
    name: '战斧',
    type: 'melee',
    damage: 35,
    range: 3,
    fireRate: 1.2,
    knockback: 0.5,
    color: 0x8b4513,
    description: '沉重的战斧，破坏力强',
  },
  [WeaponType.BOW]: {
    name: '弓',
    type: 'ranged',
    damage: 15,
    range: 50,
    fireRate: 1.5,
    projectileSpeed: 40,
    maxAmmo: 64,
    color: 0x8b4513,
    description: '远程弓箭，需要箭矢',
  },
  [WeaponType.GUN]: {
    name: '手枪',
    type: 'ranged',
    damage: 30,
    range: 80,
    fireRate: 3,
    projectileSpeed: 100,
    maxAmmo: 12,
    color: 0x333333,
    description: '快速射击的手枪',
  },
};

// ==================== 物品定义 ====================

/**
 * 物品类型
 */
export const ItemType = {
  WEAPON: 'weapon',
  BLOCK: 'block',
  AMMO: 'ammo',
  CONSUMABLE: 'consumable',
};

/**
 * 物品定义
 */
export const ItemDefs = {
  // 武器
  iron_sword: { type: ItemType.WEAPON, weaponType: WeaponType.SWORD, stackable: false },
  war_axe: { type: ItemType.WEAPON, weaponType: WeaponType.AXE, stackable: false },
  bow: { type: ItemType.WEAPON, weaponType: WeaponType.BOW, stackable: false },
  pistol: { type: ItemType.WEAPON, weaponType: WeaponType.GUN, stackable: false },
  
  // 弹药
  arrow: { type: ItemType.AMMO, stackable: true, maxStack: 64, name: '箭矢' },
  bullet: { type: ItemType.AMMO, stackable: true, maxStack: 32, name: '子弹' },
  
  // 消耗品
  health_potion: { type: ItemType.CONSUMABLE, stackable: true, maxStack: 16, name: '治疗药水', healAmount: 30 },
};

// ==================== 子弹类 ====================

/**
 * 子弹实体
 */
export class Bullet {
  constructor(position, direction, speed, damage, owner, isArrow = false) {
    this.position = position.clone();
    this.velocity = direction.clone().multiplyScalar(speed);
    this.damage = damage;
    this.owner = owner; // 'player' or entity reference
    this.isArrow = isArrow;
    this.lifetime = 3; // 秒
    this.age = 0;
    this.active = true;
    
    // 创建子弹网格
    this.mesh = this._createMesh();
    this.mesh.position.copy(this.position);
  }
  
  _createMesh() {
    if (this.isArrow) {
      // 箭矢 - 细长圆柱
      const geometry = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6);
      geometry.rotateX(Math.PI / 2);
      const material = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
      const mesh = new THREE.Mesh(geometry, material);
      
      // 箭头
      const tipGeo = new THREE.ConeGeometry(0.08, 0.2, 6);
      tipGeo.rotateX(Math.PI / 2);
      const tipMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.z = 0.4;
      mesh.add(tip);
      
      return mesh;
    } else {
      // 子弹 - 小球
      const geometry = new THREE.SphereGeometry(0.08, 8, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      return new THREE.Mesh(geometry, material);
    }
  }
  
  update(dt, world) {
    if (!this.active) return false;
    
    this.age += dt;
    if (this.age >= this.lifetime) {
      this.active = false;
      return false;
    }
    
    // 箭矢受重力影响
    if (this.isArrow) {
      this.velocity.y -= 15 * dt; // 重力
    }
    
    // 移动子弹
    const prevPos = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);
    
    // 更新网格位置和朝向
    this.mesh.position.copy(this.position);
    if (this.isArrow) {
      this.mesh.lookAt(this.position.clone().add(this.velocity));
    }
    
    // 碰撞检测
    const hit = this._checkCollision(prevPos, this.position, world);
    if (hit) {
      this.active = false;
      return hit;
    }
    
    return null;
  }
  
  _checkCollision(from, to, world) {
    // 检测方块碰撞
    const blockHit = this._checkBlockCollision(from, to, world);
    if (blockHit) return { type: 'block', ...blockHit };
    
    return null;
  }
  
  _checkBlockCollision(from, to, world) {
    // 使用射线检测方块
    const dir = to.clone().sub(from).normalize();
    const dist = from.distanceTo(to);
    
    // DDA 算法检测方块
    let x = Math.floor(from.x);
    let y = Math.floor(from.y);
    let z = Math.floor(from.z);
    
    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    
    const tDeltaX = Math.abs(1 / dir.x);
    const tDeltaY = Math.abs(1 / dir.y);
    const tDeltaZ = Math.abs(1 / dir.z);
    
    let tMaxX = dir.x > 0 ? (x + 1 - from.x) / dir.x : (from.x - x) / -dir.x;
    let tMaxY = dir.y > 0 ? (y + 1 - from.y) / dir.y : (from.y - y) / -dir.y;
    let tMaxZ = dir.z > 0 ? (z + 1 - from.z) / dir.z : (from.z - z) / -dir.z;
    
    let traveled = 0;
    let lastFace = null;
    
    while (traveled < dist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        traveled = tMaxX;
        tMaxX += tDeltaX;
        lastFace = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        traveled = tMaxY;
        tMaxY += tDeltaY;
        lastFace = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        traveled = tMaxZ;
        tMaxZ += tDeltaZ;
        lastFace = { x: 0, y: 0, z: -stepZ };
      }
      
      const block = world.getBlock(x, y, z);
      if (block !== BlockType.AIR && isSolid(block)) {
        return { x, y, z, face: lastFace, block };
      }
    }
    
    return null;
  }
  
  dispose() {
    if (this.mesh) {
      this.mesh.geometry?.dispose();
      this.mesh.material?.dispose();
    }
  }
}

// ==================== 子弹管理器 ====================

/**
 * 子弹管理器
 */
export class BulletManager {
  constructor(scene) {
    this.scene = scene;
    this.bullets = [];
  }
  
  /**
   * 发射子弹
   */
  shoot(origin, direction, speed, damage, isArrow = false) {
    const bullet = new Bullet(origin, direction, speed, damage, 'player', isArrow);
    this.bullets.push(bullet);
    this.scene.add(bullet.mesh);
    return bullet;
  }
  
  /**
   * 更新所有子弹
   */
  update(dt, world) {
    const hits = [];
    
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const hit = bullet.update(dt, world);
      
      if (hit) {
        hits.push({ bullet, hit });
        this._onBulletHit(bullet, hit);
      }
      
      if (!bullet.active) {
        this.scene.remove(bullet.mesh);
        bullet.dispose();
        this.bullets.splice(i, 1);
      }
    }
    
    return hits;
  }
  
  _onBulletHit(bullet, hit) {
    if (hit.type === 'block') {
      // 方块被击中 - 可以添加破坏效果
      this._createHitParticles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0x888888);
    }
  }
  
  _createHitParticles(x, y, z, color) {
    // 简单的粒子效果
    const particles = [];
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.SphereGeometry(0.05, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, y, z);
      p.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 3,
        (Math.random() - 0.5) * 3
      );
      p.userData.life = 0.5;
      this.scene.add(p);
      particles.push(p);
    }
    
    // 简单的粒子更新（在下一帧移除）
    setTimeout(() => {
      particles.forEach(p => {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
      });
    }, 500);
  }
  
  /**
   * 清理所有子弹
   */
  dispose() {
    for (const bullet of this.bullets) {
      this.scene.remove(bullet.mesh);
      bullet.dispose();
    }
    this.bullets = [];
  }
}

// ==================== 近战攻击 ====================

/**
 * 近战攻击检测
 */
export function meleeAttack(player, world, weaponDef) {
  const { damage, range, knockback } = weaponDef;
  
  // 获取玩家朝向
  const direction = new THREE.Vector3();
  player.camera.getWorldDirection(direction);
  
  // 检测范围内的方块
  const hitBlocks = [];
  const origin = player.position.clone();
  origin.y += 1.5; // 眼睛高度
  
  // 使用射线检测
  const ray = new THREE.Raycaster(origin, direction, 0, range);
  
  // DDA 算法检测方块
  const hits = raycastBlocks(origin, direction, range, world);
  
  if (hits.length > 0) {
    const hit = hits[0];
    // 对方块造成伤害
    return {
      type: 'block',
      x: hit.x,
      y: hit.y,
      z: hit.z,
      damage: damage,
      block: hit.block,
    };
  }
  
  return null;
}

/**
 * 方块射线检测
 */
export function raycastBlocks(origin, direction, maxDist, world) {
  const hits = [];
  
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  
  const stepX = direction.x > 0 ? 1 : -1;
  const stepY = direction.y > 0 ? 1 : -1;
  const stepZ = direction.z > 0 ? 1 : -1;
  
  const tDeltaX = Math.abs(1 / direction.x);
  const tDeltaY = Math.abs(1 / direction.y);
  const tDeltaZ = Math.abs(1 / direction.z);
  
  let tMaxX = direction.x > 0 ? (x + 1 - origin.x) / direction.x : (origin.x - x) / -direction.x;
  let tMaxY = direction.y > 0 ? (y + 1 - origin.y) / direction.y : (origin.y - y) / -direction.y;
  let tMaxZ = direction.z > 0 ? (z + 1 - origin.z) / direction.z : (origin.z - z) / -direction.z;
  
  let traveled = 0;
  let lastFace = null;
  
  while (traveled < maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      traveled = tMaxX;
      tMaxX += tDeltaX;
      lastFace = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      traveled = tMaxY;
      tMaxY += tDeltaY;
      lastFace = { x: 0, y: -stepY, z: 0 };
    } else {
      z += stepZ;
      traveled = tMaxZ;
      tMaxZ += tDeltaZ;
      lastFace = { x: 0, y: 0, z: -stepZ };
    }
    
    const block = world.getBlock(x, y, z);
    if (block !== BlockType.AIR && isSolid(block)) {
      hits.push({ x, y, z, face: lastFace, block, distance: traveled });
    }
  }
  
  return hits;
}

// ==================== 武器模型 ====================

/**
 * 创建武器第一人称模型
 */
export function createWeaponMesh(weaponType) {
  const group = new THREE.Group();
  const def = WeaponDefs[weaponType];
  
  switch (weaponType) {
    case WeaponType.SWORD: {
      // 剑身
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.8),
        new THREE.MeshLambertMaterial({ color: 0xcccccc })
      );
      blade.position.z = -0.4;
      group.add(blade);
      
      // 剑柄
      const hilt = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.2),
        new THREE.MeshLambertMaterial({ color: 0x8b4513 })
      );
      hilt.position.z = 0.1;
      group.add(hilt);
      
      // 护手
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.05, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xffd700 })
      );
      guard.position.z = 0;
      group.add(guard);
      break;
    }
    
    case WeaponType.AXE: {
      // 斧柄
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8),
        new THREE.MeshLambertMaterial({ color: 0x8b4513 })
      );
      handle.rotation.x = Math.PI / 2;
      handle.position.z = -0.2;
      group.add(handle);
      
      // 斧头
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.15, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x666666 })
      );
      head.position.set(0.1, 0, -0.5);
      group.add(head);
      break;
    }
    
    case WeaponType.BOW: {
      // 弓身（弯曲的圆柱）
      const bowCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.3, 0),
        new THREE.Vector3(0.1, -0.15, 0),
        new THREE.Vector3(0.15, 0, 0),
        new THREE.Vector3(0.1, 0.15, 0),
        new THREE.Vector3(0, 0.3, 0),
      ]);
      const bowGeo = new THREE.TubeGeometry(bowCurve, 20, 0.02, 8, false);
      const bow = new THREE.Mesh(bowGeo, new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
      group.add(bow);
      
      // 弓弦
      const stringGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -0.3, 0),
        new THREE.Vector3(0, 0.3, 0),
      ]);
      const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
      group.add(string);
      break;
    }
    
    case WeaponType.GUN: {
      // 枪身
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.12, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x333333 })
      );
      body.position.z = -0.2;
      group.add(body);
      
      // 枪管
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8),
        new THREE.MeshLambertMaterial({ color: 0x222222 })
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.5);
      group.add(barrel);
      
      // 握把
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.15, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x4a3728 })
      );
      grip.position.set(0, -0.12, -0.1);
      grip.rotation.x = -0.2;
      group.add(grip);
      break;
    }
  }
  
  return group;
}
