/**
 * 像素方块世界 - 武器系统
 * 包含：武器定义、弹药系统、子弹系统、近战攻击、第一人称武器渲染、伤害计算、换弹进度
 */
import * as THREE from 'three';
import { BlockType, BlockNames, isSolid, CHUNK_HEIGHT } from './voxel.js?v=12';

/* ============================================
   武器类型定义
   ============================================ */
export const WeaponType = {
  FIST: 'fist',
  SWORD: 'sword',
  AXE: 'axe',
  PICKAXE: 'pickaxe',
  PISTOL: 'pistol',
  RIFLE: 'rifle',
  SHOTGUN: 'shotgun',
};

/** 武器属性配置 */
export const WeaponDefs = {
  [WeaponType.FIST]: {
    name: '拳头',
    type: 'melee',
    damage: 1,
    range: 4,
    cooldown: 0.4,
    blockDamage: 1,
    color: 0xD4A574,
  },
  [WeaponType.SWORD]: {
    name: '像素剑',
    type: 'melee',
    damage: 5,
    range: 5,
    cooldown: 0.35,
    blockDamage: 2,
    color: 0x4FC3F7,
  },
  [WeaponType.AXE]: {
    name: '战斧',
    type: 'melee',
    damage: 8,
    range: 4.5,
    cooldown: 0.6,
    blockDamage: 4,
    color: 0x8D6E63,
  },
  [WeaponType.PICKAXE]: {
    name: '镐',
    type: 'melee',
    damage: 3,
    range: 4,
    cooldown: 0.3,
    blockDamage: 6,
    color: 0x78909C,
  },
  [WeaponType.PISTOL]: {
    name: '激光手枪',
    type: 'ranged',
    damage: 4,
    range: 50,
    cooldown: 0.3,
    blockDamage: 1,
    bulletSpeed: 80,
    bulletColor: 0xFFEB3B,
    bulletSize: 0.08,
    recoil: 0.02,
    magSize: 12,
    reloadTime: 1.5,
    ammoType: 'pistol',
    spread: 0.01,
    bodyColor: 0x546E7A,
  },
  [WeaponType.RIFLE]: {
    name: '等离子步枪',
    type: 'ranged',
    damage: 7,
    range: 80,
    cooldown: 0.12,
    blockDamage: 2,
    bulletSpeed: 120,
    bulletColor: 0x00E5FF,
    bulletSize: 0.1,
    recoil: 0.015,
    magSize: 30,
    reloadTime: 2.0,
    ammoType: 'rifle',
    spread: 0.02,
    bodyColor: 0x37474F,
  },
  [WeaponType.SHOTGUN]: {
    name: '霰弹枪',
    type: 'ranged',
    damage: 3,
    range: 25,
    cooldown: 0.8,
    blockDamage: 1,
    bulletSpeed: 60,
    bulletColor: 0xFF6D00,
    bulletSize: 0.06,
    recoil: 0.05,
    magSize: 6,
    reloadTime: 2.5,
    ammoType: 'shotgun',
    pellets: 5,
    spread: 0.08,
    bodyColor: 0x4E342E,
  },
};

/* ============================================
   方块生命值系统
   ============================================ */
const BLOCK_HP = {
  [BlockType.GRASS]: 3,
  [BlockType.DIRT]: 4,
  [BlockType.STONE]: 10,
  [BlockType.SAND]: 2,
  [BlockType.WOOD]: 6,
  [BlockType.LEAVES]: 1,
  [BlockType.WATER]: 999,
  [BlockType.COZE_CYAN]: 8,
};

/** 获取方块最大生命值 */
export function getBlockMaxHP(blockType) {
  return BLOCK_HP[blockType] || 5;
}

/* ============================================
   子弹类
   ============================================ */
class Bullet {
  constructor(scene, origin, direction, weaponDef, owner) {
    this.scene = scene;
    this.weaponDef = weaponDef;
    this.owner = owner;
    this.alive = true;
    this.age = 0;
    this.maxAge = weaponDef.range / weaponDef.bulletSpeed + 0.5;

    const size = weaponDef.bulletSize || 0.1;
    const geo = new THREE.BoxGeometry(size, size, size * 3);
    const mat = new THREE.MeshBasicMaterial({ color: weaponDef.bulletColor });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(origin);

    this.velocity = direction.clone().multiplyScalar(weaponDef.bulletSpeed);
    this.mesh.lookAt(
      origin.x + direction.x,
      origin.y + direction.y,
      origin.z + direction.z
    );

    // 发光效果
    const glowMat = new THREE.MeshBasicMaterial({
      color: weaponDef.bulletColor,
      transparent: true,
      opacity: 0.3,
    });
    const glowGeo = new THREE.BoxGeometry(size * 2.5, size * 2.5, size * 4);
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.mesh.add(this.glow);

    scene.add(this.mesh);
  }

  update(dt, world, animalManager) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age > this.maxAge) {
      this.destroy();
      return;
    }

    const moveVec = this.velocity.clone().multiplyScalar(dt);
    this.mesh.position.add(moveVec);

    // 碰撞检测 - 方块
    const bx = Math.floor(this.mesh.position.x);
    const by = Math.floor(this.mesh.position.y);
    const bz = Math.floor(this.mesh.position.z);

    if (by >= 0 && by < CHUNK_HEIGHT) {
      const block = world.getBlock(bx, by, bz);
      if (isSolid(block)) {
        this._hitBlock(world, bx, by, bz, block);
        this.destroy();
        return;
      }
    }

    // 碰撞检测 - 生物
    if (animalManager) {
      for (const animal of animalManager.animals) {
        if (!animal.alive) continue;
        const dist = this.mesh.position.distanceTo(animal.position);
        if (dist < 1.2) {
          animal.takeDamage(this.weaponDef.damage, { position: this.mesh.position.clone() });
          this.destroy();
          return;
        }
      }
    }

    // 超出世界范围
    if (this.mesh.position.y < -10 || this.mesh.position.y > 100) {
      this.destroy();
    }
  }

  _hitBlock(world, x, y, z, blockType) {
    const maxHP = getBlockMaxHP(blockType);
    if (maxHP >= 999) return;

    if (!world.blockDamage) world.blockDamage = {};
    const key = `${x},${y},${z}`;
    if (!world.blockDamage[key]) {
      world.blockDamage[key] = { hp: maxHP, type: blockType };
    }

    world.blockDamage[key].hp -= this.weaponDef.blockDamage;
    this._spawnHitParticles(x, y, z, blockType);

    if (world.blockDamage[key].hp <= 0) {
      world.setBlock(x, y, z, BlockType.AIR);
      delete world.blockDamage[key];
      this._spawnBreakParticles(x, y, z, blockType);
    }
  }

  _spawnHitParticles(x, y, z, blockType) {
    const color = _getBlockParticleColor(blockType);
    for (let i = 0; i < 4; i++) {
      const size = 0.08 + Math.random() * 0.06;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(particle);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      particle._vel = vel;
      particle._life = 0.5 + Math.random() * 0.3;

      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }
  }

  _spawnBreakParticles(x, y, z, blockType) {
    const color = _getBlockParticleColor(blockType);
    for (let i = 0; i < 12; i++) {
      const size = 0.06 + Math.random() * 0.1;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(particle);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 6
      );
      particle._vel = vel;
      particle._life = 0.6 + Math.random() * 0.5;

      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }
  }

  destroy() {
    this.alive = false;
    this.scene.remove(this.mesh);
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

/** 获取方块粒子颜色 */
function _getBlockParticleColor(blockType) {
  const colors = {
    [BlockType.GRASS]: 0x4CAF50,
    [BlockType.DIRT]: 0x8B6914,
    [BlockType.STONE]: 0x808080,
    [BlockType.SAND]: 0xDBC67B,
    [BlockType.WOOD]: 0x6D4C41,
    [BlockType.LEAVES]: 0x2E7D32,
    [BlockType.COZE_CYAN]: 0x00BCD4,
  };
  return colors[blockType] || 0x888888;
}

/* ============================================
   受击特效工具
   ============================================ */
export function spawnHitEffect(scene, position, color) {
  // 受击粒子爆炸
  for (let i = 0; i < 8; i++) {
    const size = 0.06 + Math.random() * 0.08;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const particle = new THREE.Mesh(geo, mat);
    particle.position.copy(position);
    scene.add(particle);

    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      Math.random() * 4 + 1,
      (Math.random() - 0.5) * 8
    );
    particle._vel = vel;
    particle._life = 0.3 + Math.random() * 0.3;

    if (!scene._particles) scene._particles = [];
    scene._particles.push(particle);
  }
}

/** 创建击退力 */
export function computeKnockback(hitPos, fromPos, strength) {
  const dir = new THREE.Vector3().subVectors(hitPos, fromPos).normalize();
  dir.y = 0.3; // 向上偏移一点
  return dir.multiplyScalar(strength);
}

/* ============================================
   武器渲染器 - 第一人称手持武器
   ============================================ */
export class WeaponRenderer {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.currentWeapon = null;
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.renderOrder = 999;
    this.swingPhase = 0;
    this.recoilPhase = 0;
    this.bobPhase = 0;
  }

  /** 切换武器 */
  setWeapon(weaponType) {
    this.currentWeapon = weaponType;
    // 清除旧模型
    while (this.weaponGroup.children.length > 0) {
      const child = this.weaponGroup.children[0];
      this.weaponGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const def = WeaponDefs[weaponType];
    if (!def || weaponType === WeaponType.FIST) {
      this._buildFist();
    } else if (def.type === 'melee') {
      this._buildMeleeWeapon(weaponType, def);
    } else {
      this._buildRangedWeapon(weaponType, def);
    }
  }

  /** 构建拳头模型 */
  _buildFist() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xD4A574 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.16), mat);
    palm.position.set(0.35, -0.32, -0.45);
    this.weaponGroup.add(palm);
  }

  /** 构建近战武器模型 */
  _buildMeleeWeapon(weaponType, def) {
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x5D4037 });

    if (weaponType === WeaponType.SWORD) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), handleMat);
      handle.position.set(0.35, -0.28, -0.48);
      this.weaponGroup.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), mat);
      guard.position.set(0.35, -0.2, -0.48);
      this.weaponGroup.add(guard);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat);
      blade.position.set(0.35, 0.0, -0.48);
      this.weaponGroup.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.08, 4), mat);
      tip.position.set(0.35, 0.22, -0.48);
      tip.rotation.z = Math.PI;
      this.weaponGroup.add(tip);
    } else if (weaponType === WeaponType.AXE) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), handleMat);
      handle.position.set(0.35, -0.15, -0.48);
      this.weaponGroup.add(handle);
      const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), mat);
      axeHead.position.set(0.38, 0.08, -0.48);
      this.weaponGroup.add(axeHead);
    } else if (weaponType === WeaponType.PICKAXE) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), handleMat);
      handle.position.set(0.35, -0.15, -0.48);
      this.weaponGroup.add(handle);
      const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.04), mat);
      pickHead.position.set(0.35, 0.1, -0.48);
      this.weaponGroup.add(pickHead);
      const pickPoint = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), mat);
      pickPoint.position.set(0.47, 0.12, -0.48);
      this.weaponGroup.add(pickPoint);
    }
  }

  /** 构建远程武器模型 */
  _buildRangedWeapon(weaponType, def) {
    const bodyColor = def.bodyColor || 0x424242;
    const mat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const accentMat = new THREE.MeshLambertMaterial({ color: def.bulletColor });

    if (weaponType === WeaponType.PISTOL) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.28), mat);
      body.position.set(0.35, -0.3, -0.5);
      this.weaponGroup.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), accentMat);
      barrel.position.set(0.35, -0.27, -0.62);
      this.weaponGroup.add(barrel);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), mat);
      grip.position.set(0.35, -0.38, -0.44);
      grip.rotation.x = 0.3;
      this.weaponGroup.add(grip);
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), glowMat);
      glow.position.set(0.35, -0.27, -0.68);
      this.weaponGroup.add(glow);
    } else if (weaponType === WeaponType.RIFLE) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), mat);
      body.position.set(0.35, -0.3, -0.55);
      this.weaponGroup.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), accentMat);
      barrel.position.set(0.35, -0.27, -0.78);
      this.weaponGroup.add(barrel);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), accentMat);
      mag.position.set(0.35, -0.4, -0.52);
      this.weaponGroup.add(mag);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), mat);
      sight.position.set(0.35, -0.22, -0.52);
      this.weaponGroup.add(sight);
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), glowMat);
      glow.position.set(0.35, -0.27, -0.87);
      this.weaponGroup.add(glow);
    } else if (weaponType === WeaponType.SHOTGUN) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.4), mat);
      body.position.set(0.35, -0.3, -0.48);
      this.weaponGroup.add(body);
      // 粗枪管
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), mat);
      barrel.position.set(0.35, -0.28, -0.7);
      this.weaponGroup.add(barrel);
      // 枪口
      const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), accentMat);
      muzzle.position.set(0.35, -0.28, -0.81);
      this.weaponGroup.add(muzzle);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.05), mat);
      grip.position.set(0.35, -0.4, -0.38);
      grip.rotation.x = 0.25;
      this.weaponGroup.add(grip);
      // 泵动护木
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0x5D4037 }));
      pump.position.set(0.35, -0.32, -0.58);
      this.weaponGroup.add(pump);
    }
  }

  /** 触发挥动动画 */
  triggerSwing() {
    this.swingPhase = 1.0;
  }

  /** 触发后坐力动画 */
  triggerRecoil() {
    this.recoilPhase = 1.0;
  }

  /** 每帧更新武器动画 */
  update(dt, isMoving) {
    if (isMoving) {
      this.bobPhase += dt * 8;
    } else {
      this.bobPhase += dt * 1.5;
    }
    const bobX = Math.sin(this.bobPhase) * (isMoving ? 0.015 : 0.003);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * (isMoving ? 0.012 : 0.002);

    if (this.swingPhase > 0) {
      this.swingPhase = Math.max(0, this.swingPhase - dt * 6);
    }

    if (this.recoilPhase > 0) {
      this.recoilPhase = Math.max(0, this.recoilPhase - dt * 8);
    }

    const swingAngle = this.swingPhase * Math.PI * 0.6;
    const recoilZ = this.recoilPhase * 0.08;

    this.weaponGroup.position.set(bobX, bobY - recoilZ * 0.3, -recoilZ);
    this.weaponGroup.rotation.set(-swingAngle * 0.5, 0, -swingAngle * 0.3);

    this.camera.add(this.weaponGroup);
  }
}

/* ============================================
   武器管理器 - 统管武器使用、子弹生命周期、弹药、换弹
   ============================================ */
export class WeaponManager {
  constructor(scene, camera, world, animalManager) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.animalManager = animalManager;

    this.renderer = new WeaponRenderer(camera, scene);
    this.currentWeapon = WeaponType.FIST;
    this.cooldownTimer = 0;

    // 弹药系统
    this.currentAmmo = {};   // 武器类型 -> 当前弹匣剩余
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.reloadingWeaponType = null;

    // 初始化弹匣
    for (const [key, def] of Object.entries(WeaponDefs)) {
      if (def.type === 'ranged' && def.magSize) {
        this.currentAmmo[key] = def.magSize;
      }
    }

    // 活跃子弹列表
    this.bullets = [];

    // 初始化粒子列表
    if (!this.scene._particles) this.scene._particles = [];

    // 设置默认武器
    this.renderer.setWeapon(WeaponType.FIST);

    // 换弹进度回调
    this.onReloadProgress = null;
    this.onReloadComplete = null;
    this.onAmmoChanged = null;
  }

  /** 切换当前武器 */
  switchWeapon(weaponType) {
    if (this.currentWeapon === weaponType) return;
    this.currentWeapon = weaponType;
    this.renderer.setWeapon(weaponType);
    // 切换武器时取消换弹
    if (this.isReloading) {
      this.isReloading = false;
      this.reloadTimer = 0;
    }
    this.onAmmoChanged?.();
  }

  /** 射击（从game.js调用） */
  shoot(weaponType, player) {
    if (this.cooldownTimer > 0) return;
    if (this.isReloading) return;

    const def = WeaponDefs[weaponType];
    if (!def || def.type !== 'ranged') return;

    // 检查弹匣
    const ammo = this.currentAmmo[weaponType] ?? 0;
    if (ammo <= 0) {
      this.startReload(weaponType);
      return;
    }

    this.currentWeapon = weaponType;
    this.renderer.setWeapon(weaponType);
    this.cooldownTimer = def.cooldown;

    // 消耗弹药
    this.currentAmmo[weaponType] = ammo - 1;
    this.onAmmoChanged?.();

    // 霰弹枪散射
    const pellets = def.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      this._rangedAttack(def, player.yaw, player.pitch);
    }

    // 弹匣打空自动换弹
    if (this.currentAmmo[weaponType] <= 0) {
      this.startReload(weaponType);
    }
  }

  /** 开始换弹 */
  startReload(weaponType) {
    const def = WeaponDefs[weaponType];
    if (!def || def.type !== 'ranged') return;
    if (this.isReloading) return;
    if (this.currentAmmo[weaponType] >= def.magSize) return;

    this.isReloading = true;
    this.reloadingWeaponType = weaponType;
    this.reloadDuration = def.reloadTime;
    this.reloadTimer = 0;
  }

  /** 近战攻击（从game.js调用） */
  meleeAttack(weaponType, player) {
    if (this.cooldownTimer > 0) return;
    if (this.isReloading) return;
    const def = WeaponDefs[weaponType];
    if (!def) return;
    this.currentWeapon = weaponType;
    this.renderer.setWeapon(weaponType);
    this.cooldownTimer = def.cooldown;
    this._meleeAttack(def, player.yaw, player.pitch);
    this.onAmmoChanged?.();
  }

  /** 执行攻击（左键） */
  attack(playerYaw, playerPitch) {
    if (this.cooldownTimer > 0) return false;
    if (this.isReloading) return false;

    const def = WeaponDefs[this.currentWeapon];
    if (!def) return false;

    this.cooldownTimer = def.cooldown;

    if (def.type === 'melee') {
      return this._meleeAttack(def, playerYaw, playerPitch);
    } else {
      return this._rangedAttack(def, playerYaw, playerPitch);
    }
  }

  /** 近战攻击 */
  _meleeAttack(def, yaw, pitch) {
    this.renderer.triggerSwing();

    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    const origin = this.camera.position.clone();

    const step = 0.1;
    const maxSteps = def.range / step;
    let prevX = Math.floor(origin.x);
    let prevY = Math.floor(origin.y);
    let prevZ = Math.floor(origin.z);

    for (let i = 0; i < maxSteps; i++) {
      const t = i * step;
      const x = Math.floor(origin.x + dir.x * t);
      const y = Math.floor(origin.y + dir.y * t);
      const z = Math.floor(origin.z + dir.z * t);

      if (x === prevX && y === prevY && z === prevZ) continue;

      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        this._damageBlock(x, y, z, block, def.blockDamage);
        return true;
      }

      if (this.animalManager) {
        const hitPos = new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
        for (const animal of this.animalManager.animals) {
          if (!animal.alive) continue;
          const dist = hitPos.distanceTo(animal.position);
          if (dist < 1.2) {
            animal.takeDamage(def.damage, { position: this.camera.position.clone() });
            return true;
          }
        }
      }

      prevX = x;
      prevY = y;
      prevZ = z;
    }

    return true;
  }

  /** 远程攻击 */
  _rangedAttack(def, yaw, pitch) {
    this.renderer.triggerRecoil();

    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    // 添加散布
    if (def.spread) {
      dir.x += (Math.random() - 0.5) * def.spread;
      dir.y += (Math.random() - 0.5) * def.spread;
      dir.z += (Math.random() - 0.5) * def.spread;
      dir.normalize();
    }

    const origin = this.camera.position.clone().add(dir.clone().multiplyScalar(0.5));

    const bullet = new Bullet(this.scene, origin, dir, def, 'player');
    this.bullets.push(bullet);

    return true;
  }

  /** 对方块造成伤害 */
  _damageBlock(x, y, z, blockType, damage) {
    const maxHP = getBlockMaxHP(blockType);
    if (maxHP >= 999) return;

    if (!this.world.blockDamage) this.world.blockDamage = {};
    const key = `${x},${y},${z}`;
    if (!this.world.blockDamage[key]) {
      this.world.blockDamage[key] = { hp: maxHP, type: blockType };
    }

    this.world.blockDamage[key].hp -= damage;
    this._spawnHitParticles(x, y, z, blockType);

    if (this.world.blockDamage[key].hp <= 0) {
      this.world.setBlock(x, y, z, BlockType.AIR);
      delete this.world.blockDamage[key];
      this._spawnBreakParticles(x, y, z, blockType);
    }
  }

  _spawnHitParticles(x, y, z, blockType) {
    const color = _getBlockParticleColor(blockType);
    for (let i = 0; i < 5; i++) {
      const size = 0.06 + Math.random() * 0.08;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(particle);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      particle._vel = vel;
      particle._life = 0.4 + Math.random() * 0.3;

      this.scene._particles.push(particle);
    }
  }

  _spawnBreakParticles(x, y, z, blockType) {
    const color = _getBlockParticleColor(blockType);
    for (let i = 0; i < 15; i++) {
      const size = 0.05 + Math.random() * 0.12;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(particle);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 6
      );
      particle._vel = vel;
      particle._life = 0.5 + Math.random() * 0.5;

      this.scene._particles.push(particle);
    }
  }

  /** 获取换弹进度 0~1 */
  getReloadProgress() {
    if (!this.isReloading) return 0;
    return Math.min(1, this.reloadTimer / this.reloadDuration);
  }

  /** 获取当前弹匣信息 */
  getAmmoInfo(weaponType) {
    const def = WeaponDefs[weaponType];
    if (!def || def.type !== 'ranged') return null;
    return {
      current: this.currentAmmo[weaponType] ?? 0,
      max: def.magSize,
    };
  }

  /** 每帧更新 */
  update(dt, isMoving) {
    // 冷却计时
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }

    // 换弹计时
    if (this.isReloading) {
      this.reloadTimer += dt;
      this.onReloadProgress?.(this.getReloadProgress());

      if (this.reloadTimer >= this.reloadDuration) {
        // 换弹完成
        const def = WeaponDefs[this.reloadingWeaponType];
        this.currentAmmo[this.reloadingWeaponType] = def.magSize;
        this.isReloading = false;
        this.reloadTimer = 0;
        this.onReloadComplete?.();
        this.onAmmoChanged?.();
      }
    }

    // 更新子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.update(dt, this.world, this.animalManager);
      if (!bullet.alive) {
        this.bullets.splice(i, 1);
      }
    }

    // 更新粒子
    const particles = this.scene._particles;
    if (particles) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p._life -= dt;
        if (p._life <= 0) {
          this.scene.remove(p);
          if (p.geometry) p.geometry.dispose();
          if (p.material) p.material.dispose();
          particles.splice(i, 1);
          continue;
        }
        p.position.add(p._vel.clone().multiplyScalar(dt));
        p._vel.y -= 15 * dt;
        p.material.opacity = Math.max(0, p._life * 2);
        p.material.transparent = true;
      }
    }

    // 更新武器渲染
    this.renderer.update(dt, isMoving);
  }
}

/* ============================================
   背包系统
   ============================================ */
export class Inventory {
  constructor() {
    this.rows = 6;
    this.cols = 9;
    this.slots = new Array(this.rows * this.cols).fill(null);
    this.selectedSlot = 0;
    this._initStarterItems();
  }

  _initStarterItems() {
    const starterItems = [
      { type: 'block', blockType: BlockType.GRASS, count: 64 },
      { type: 'block', blockType: BlockType.DIRT, count: 64 },
      { type: 'block', blockType: BlockType.STONE, count: 64 },
      { type: 'block', blockType: BlockType.SAND, count: 64 },
      { type: 'block', blockType: BlockType.WOOD, count: 64 },
      { type: 'block', blockType: BlockType.LEAVES, count: 64 },
      { type: 'weapon', weaponType: WeaponType.SWORD, count: 1 },
      { type: 'weapon', weaponType: WeaponType.PISTOL, count: 1 },
      { type: 'weapon', weaponType: WeaponType.AXE, count: 1 },
    ];

    starterItems.forEach((item, i) => {
      this.slots[i] = { ...item };
    });

    this.slots[9] = { type: 'weapon', weaponType: WeaponType.RIFLE, count: 1 };
    this.slots[10] = { type: 'weapon', weaponType: WeaponType.SHOTGUN, count: 1 };
    this.slots[11] = { type: 'weapon', weaponType: WeaponType.PICKAXE, count: 1 };
    this.slots[12] = { type: 'ammo', ammoType: 'pistol', count: 120 };
    this.slots[13] = { type: 'ammo', ammoType: 'rifle', count: 300 };
    this.slots[14] = { type: 'ammo', ammoType: 'shotgun', count: 60 };
  }

  getHotbarItem(index) {
    return this.slots[index];
  }

  getCurrentItem() {
    return this.slots[this.selectedSlot];
  }

  selectSlot(index) {
    if (index >= 0 && index < this.cols) {
      this.selectedSlot = index;
    }
  }

  swapSlots(from, to) {
    const temp = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to] = temp;
  }

  addItem(item) {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot && slot.type === item.type) {
        if (item.type === 'block' && slot.blockType === item.blockType) {
          slot.count += item.count;
          return true;
        }
        if (item.type === 'ammo' && slot.ammoType === item.ammoType) {
          slot.count += item.count;
          return true;
        }
      }
    }
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = { ...item };
        return true;
      }
    }
    return false;
  }

  isCurrentWeapon() {
    const item = this.getCurrentItem();
    return item && item.type === 'weapon';
  }

  isCurrentBlock() {
    const item = this.getCurrentItem();
    return item && item.type === 'block';
  }

  getCurrentWeaponType() {
    const item = this.getCurrentItem();
    if (item && item.type === 'weapon') return item.weaponType;
    return WeaponType.FIST;
  }

  getCurrentBlockType() {
    const item = this.getCurrentItem();
    if (item && item.type === 'block') return item.blockType;
    return null;
  }

  consumeCurrentBlock() {
    const item = this.getCurrentItem();
    if (item && item.type === 'block' && item.count > 0) {
      item.count--;
      if (item.count <= 0) {
        this.slots[this.selectedSlot] = null;
      }
      return true;
    }
    return false;
  }

  consumeAmmo(ammoType, amount) {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot && slot.type === 'ammo' && slot.ammoType === ammoType && slot.count >= amount) {
        slot.count -= amount;
        if (slot.count <= 0) {
          this.slots[i] = null;
        }
        return true;
      }
    }
    return false;
  }

  hasAmmo(ammoType, amount) {
    for (const slot of this.slots) {
      if (slot && slot.type === 'ammo' && slot.ammoType === ammoType && slot.count >= amount) {
        return true;
      }
    }
    return false;
  }

  /** 获取弹药类型的总数量 */
  getAmmoCount(ammoType) {
    let total = 0;
    for (const slot of this.slots) {
      if (slot && slot.type === 'ammo' && slot.ammoType === ammoType) {
        total += slot.count;
      }
    }
    return total;
  }
}

/* ============================================
   背包UI渲染器
   ============================================ */
export class InventoryUI {
  constructor(inventory) {
    this.inventory = inventory;
    this.isOpen = false;
    this.dragFrom = -1;

    this.container = document.createElement('div');
    this.container.id = 'inventoryPanel';
    this.container.style.display = 'none';
    document.body.appendChild(this.container);

    this._buildUI();
  }

  _buildUI() {
    this.container.innerHTML = '';
    this.container.className = 'inventory-panel';

    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = '背包';
    this.container.appendChild(title);

    const hotbarSection = document.createElement('div');
    hotbarSection.className = 'inv-section';
    const hotbarLabel = document.createElement('div');
    hotbarLabel.className = 'inv-section-label';
    hotbarLabel.textContent = '快捷栏';
    hotbarSection.appendChild(hotbarLabel);

    const hotbarGrid = document.createElement('div');
    hotbarGrid.className = 'inv-grid inv-hotbar-grid';
    for (let i = 0; i < this.inventory.cols; i++) {
      hotbarGrid.appendChild(this._createSlot(i));
    }
    hotbarSection.appendChild(hotbarGrid);
    this.container.appendChild(hotbarSection);

    const backpackSection = document.createElement('div');
    backpackSection.className = 'inv-section';
    const bpLabel = document.createElement('div');
    bpLabel.className = 'inv-section-label';
    bpLabel.textContent = '背包';
    backpackSection.appendChild(bpLabel);

    const bpGrid = document.createElement('div');
    bpGrid.className = 'inv-grid inv-backpack-grid';
    for (let i = this.inventory.cols; i < this.inventory.slots.length; i++) {
      bpGrid.appendChild(this._createSlot(i));
    }
    backpackSection.appendChild(bpGrid);
    this.container.appendChild(backpackSection);
  }

  _createSlot(index) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    slot.dataset.index = index;

    const item = this.inventory.slots[index];
    if (item) {
      slot.textContent = this._itemLabel(item);
      if (item.count > 1) {
        const countEl = document.createElement('span');
        countEl.className = 'inv-count';
        countEl.textContent = item.count;
        slot.appendChild(countEl);
      }
    }

    slot.addEventListener('click', () => {
      if (this.dragFrom >= 0 && this.dragFrom !== index) {
        this.inventory.swapSlots(this.dragFrom, index);
        this.dragFrom = -1;
        this._buildUI();
      } else {
        this.dragFrom = index;
      }
    });

    return slot;
  }

  _itemLabel(item) {
    if (item.type === 'block') return BlockNames[item.blockType] || '?';
    if (item.type === 'weapon') return WeaponDefs[item.weaponType]?.name || '?';
    if (item.type === 'ammo') {
      const names = { pistol: '手枪弹', rifle: '步枪弹', shotgun: '霰弹' };
      return names[item.ammoType] || '弹药';
    }
    return '?';
  }

  open() {
    this.isOpen = true;
    this._buildUI();
    this.container.style.display = 'flex';
  }

  close() {
    this.isOpen = false;
    this.container.style.display = 'none';
  }
}
