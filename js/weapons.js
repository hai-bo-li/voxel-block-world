/**
 * 像素方块世界 - 武器系统
 * 包含：武器定义、子弹系统、近战攻击、第一人称武器渲染、伤害计算
 */
import * as THREE from 'three';
import { BlockType, isSolid, CHUNK_HEIGHT } from './voxel.js';

/* ============================================
   武器类型定义
   ============================================ */
export const WeaponType = {
  FIST: 'fist',
  SWORD: 'sword',
  AXE: 'axe',
  PISTOL: 'pistol',
  RIFLE: 'rifle',
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

    // 子弹网格
    const size = weaponDef.bulletSize || 0.1;
    const geo = new THREE.BoxGeometry(size, size, size * 3);
    const mat = new THREE.MeshBasicMaterial({ color: weaponDef.bulletColor });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(origin);

    // 子弹朝向运动方向
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

    // 移动子弹
    const moveVec = this.velocity.clone().multiplyScalar(dt);
    this.mesh.position.add(moveVec);

    // 碰撞检测 - 方块
    const bx = Math.floor(this.mesh.position.x);
    const by = Math.floor(this.mesh.position.y);
    const bz = Math.floor(this.mesh.position.z);

    if (by >= 0 && by < CHUNK_HEIGHT) {
      const block = world.getBlock(bx, by, bz);
      if (isSolid(block)) {
        // 对方块造成伤害
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
        if (dist < 0.8) {
          animal.takeDamage(this.weaponDef.damage);
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
    if (maxHP >= 999) return; // 水不可破坏

    // 获取/创建方块伤害记录
    if (!world.blockDamage) world.blockDamage = {};
    const key = `${x},${y},${z}`;
    if (!world.blockDamage[key]) {
      world.blockDamage[key] = { hp: maxHP, type: blockType };
    }

    world.blockDamage[key].hp -= this.weaponDef.blockDamage;

    // 创建击中粒子效果
    this._spawnHitParticles(x, y, z, blockType);

    if (world.blockDamage[key].hp <= 0) {
      // 方块被摧毁
      world.setBlock(x, y, z, BlockType.AIR);
      delete world.blockDamage[key];
      // 摧毁粒子
      this._spawnBreakParticles(x, y, z, blockType);
    }
  }

  _spawnHitParticles(x, y, z, blockType) {
    // 简单的粒子效果：创建几个小方块向外飞散
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

      // 添加到临时粒子列表
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
   武器渲染器 - 第一人称手持武器
   ============================================ */
export class WeaponRenderer {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.currentWeapon = null;
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.renderOrder = 999; // 始终在最前面渲染
    this.swingPhase = 0;    // 近战挥动动画
    this.recoilPhase = 0;   // 后坐力动画
    this.bobPhase = 0;      // 行走晃动
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
    // 手掌
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.16), mat);
    palm.position.set(0.35, -0.32, -0.45);
    this.weaponGroup.add(palm);
  }

  /** 构建近战武器模型 */
  _buildMeleeWeapon(weaponType, def) {
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x5D4037 });

    if (weaponType === WeaponType.SWORD) {
      // 剑柄
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), handleMat);
      handle.position.set(0.35, -0.28, -0.48);
      this.weaponGroup.add(handle);
      // 护手
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), mat);
      guard.position.set(0.35, -0.2, -0.48);
      this.weaponGroup.add(guard);
      // 剑身
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat);
      blade.position.set(0.35, 0.0, -0.48);
      this.weaponGroup.add(blade);
      // 剑尖
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.028, 0.08, 4),
        mat
      );
      tip.position.set(0.35, 0.22, -0.48);
      tip.rotation.z = Math.PI; // 尖端朝上
      this.weaponGroup.add(tip);
    } else if (weaponType === WeaponType.AXE) {
      // 斧柄
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), handleMat);
      handle.position.set(0.35, -0.15, -0.48);
      this.weaponGroup.add(handle);
      // 斧头
      const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), mat);
      axeHead.position.set(0.38, 0.08, -0.48);
      this.weaponGroup.add(axeHead);
    }
  }

  /** 构建远程武器模型 */
  _buildRangedWeapon(weaponType, def) {
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x424242 });

    if (weaponType === WeaponType.PISTOL) {
      // 枪身
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.28), bodyMat);
      body.position.set(0.35, -0.3, -0.5);
      this.weaponGroup.add(body);
      // 枪管
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), mat);
      barrel.position.set(0.35, -0.27, -0.62);
      this.weaponGroup.add(barrel);
      // 握把
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), bodyMat);
      grip.position.set(0.35, -0.38, -0.44);
      grip.rotation.x = 0.3;
      this.weaponGroup.add(grip);
      // 发光点（枪口）
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), glowMat);
      glow.position.set(0.35, -0.27, -0.68);
      this.weaponGroup.add(glow);
    } else if (weaponType === WeaponType.RIFLE) {
      // 枪身
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), bodyMat);
      body.position.set(0.35, -0.3, -0.55);
      this.weaponGroup.add(body);
      // 枪管
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), mat);
      barrel.position.set(0.35, -0.27, -0.78);
      this.weaponGroup.add(barrel);
      // 弹匣
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), mat);
      mag.position.set(0.35, -0.4, -0.52);
      this.weaponGroup.add(mag);
      // 瞄准器
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), bodyMat);
      sight.position.set(0.35, -0.22, -0.52);
      this.weaponGroup.add(sight);
      // 发光点
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), glowMat);
      glow.position.set(0.35, -0.27, -0.87);
      this.weaponGroup.add(glow);
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
    // 行走晃动
    if (isMoving) {
      this.bobPhase += dt * 8;
    } else {
      this.bobPhase += dt * 1.5;
    }
    const bobX = Math.sin(this.bobPhase) * (isMoving ? 0.015 : 0.003);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * (isMoving ? 0.012 : 0.002);

    // 挥动动画衰减
    if (this.swingPhase > 0) {
      this.swingPhase = Math.max(0, this.swingPhase - dt * 6);
    }

    // 后坐力衰减
    if (this.recoilPhase > 0) {
      this.recoilPhase = Math.max(0, this.recoilPhase - dt * 8);
    }

    // 计算武器组变换
    const swingAngle = this.swingPhase * Math.PI * 0.6;
    const recoilZ = this.recoilPhase * 0.08;

    this.weaponGroup.position.set(bobX, bobY - recoilZ * 0.3, -recoilZ);
    this.weaponGroup.rotation.set(-swingAngle * 0.5, 0, -swingAngle * 0.3);

    // 武器组跟随相机
    this.camera.add(this.weaponGroup);
  }
}

/* ============================================
   武器管理器 - 统管武器使用、子弹生命周期
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

    // 活跃子弹列表
    this.bullets = [];

    // 初始化粒子列表
    if (!this.scene._particles) this.scene._particles = [];

    // 设置默认武器
    this.renderer.setWeapon(WeaponType.FIST);
  }

  /** 切换当前武器 */
  switchWeapon(weaponType) {
    if (this.currentWeapon === weaponType) return;
    this.currentWeapon = weaponType;
    this.renderer.setWeapon(weaponType);
  }

  /** 执行攻击（左键） */
  attack(playerYaw, playerPitch) {
    if (this.cooldownTimer > 0) return false;

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

    // 计算视线方向
    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    const origin = this.camera.position.clone();

    // 步进检测碰撞
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

      // 检测方块碰撞
      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        this._damageBlock(x, y, z, block, def.blockDamage);
        return true;
      }

      // 检测生物碰撞
      if (this.animalManager) {
        const hitPos = new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
        for (const animal of this.animalManager.animals) {
          if (!animal.alive) continue;
          const dist = hitPos.distanceTo(animal.position);
          if (dist < 1.0) {
            animal.takeDamage(def.damage);
            return true;
          }
        }
      }

      prevX = x;
      prevY = y;
      prevZ = z;
    }

    return true; // 挥空了也算一次攻击
  }

  /** 远程攻击 */
  _rangedAttack(def, yaw, pitch) {
    this.renderer.triggerRecoil();

    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    // 枪口位置（相机前方偏移）
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

    // 击中粒子
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

  /** 每帧更新 */
  update(dt, isMoving) {
    // 冷却计时
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
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
        p._vel.y -= 15 * dt; // 重力
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
    // 背包格子 (6行 x 9列 = 54格)
    this.rows = 6;
    this.cols = 9;
    this.slots = new Array(this.rows * this.cols).fill(null);

    // 快捷栏映射（底部第一行 = 前9格）
    this.selectedSlot = 0;

    // 初始物品
    this._initStarterItems();
  }

  _initStarterItems() {
    // 快捷栏初始物品
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

    // 额外物品放第二行
    this.slots[9] = { type: 'weapon', weaponType: WeaponType.RIFLE, count: 1 };
    // 弹药
    this.slots[10] = { type: 'ammo', ammoType: 'pistol', count: 120 };
    this.slots[11] = { type: 'ammo', ammoType: 'rifle', count: 300 };
  }

  /** 获取快捷栏物品 (0-8) */
  getHotbarItem(index) {
    return this.slots[index];
  }

  /** 获取当前选中的快捷栏物品 */
  getCurrentItem() {
    return this.slots[this.selectedSlot];
  }

  /** 切换快捷栏选中 */
  selectSlot(index) {
    if (index >= 0 && index < this.cols) {
      this.selectedSlot = index;
    }
  }

  /** 交换两个背包格子的物品 */
  swapSlots(from, to) {
    const temp = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to] = temp;
  }

  /** 添加物品到背包（找空位或同类堆叠） */
  addItem(item) {
    // 先尝试堆叠
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
    // 找空位
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = { ...item };
        return true;
      }
    }
    return false; // 背包满了
  }

  /** 判断当前选中的是否是武器 */
  isCurrentWeapon() {
    const item = this.getCurrentItem();
    return item && item.type === 'weapon';
  }

  /** 判断当前选中的是否是方块 */
  isCurrentBlock() {
    const item = this.getCurrentItem();
    return item && item.type === 'block';
  }

  /** 获取当前武器的类型 */
  getCurrentWeaponType() {
    const item = this.getCurrentItem();
    if (item && item.type === 'weapon') return item.weaponType;
    return WeaponType.FIST;
  }

  /** 获取当前方块类型 */
  getCurrentBlockType() {
    const item = this.getCurrentItem();
    if (item && item.type === 'block') return item.blockType;
    return null;
  }

  /** 消耗一个当前选中方块 */
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

  /** 消耗弹药 */
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

  /** 检查是否有弹药 */
  hasAmmo(ammoType, amount) {
    for (const slot of this.slots) {
      if (slot && slot.type === 'ammo' && slot.ammoType === ammoType && slot.count >= amount) {
        return true;
      }
    }
    return false;
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

    // 创建DOM
    this.container = document.createElement('div');
    this.container.id = 'inventoryPanel';
    this.container.style.display = 'none';
    document.body.appendChild(this.container);

    this._buildUI();
  }

  _buildUI() {
    this.container.innerHTML = '';
    this.container.className = 'inventory-panel';

    // 标题
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = '背包';
    this.container.appendChild(title);

    // 快捷栏区域
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

    // 背包区域
    const bagSection = document.createElement('div');
    bagSection.className = 'inv-section';
    const bagLabel = document.createElement('div');
    bagLabel.className = 'inv-section-label';
    bagLabel.textContent = '背包';
    bagSection.appendChild(bagLabel);

    const bagGrid = document.createElement('div');
    bagGrid.className = 'inv-grid inv-bag-grid';
    for (let i = this.inventory.cols; i < this.inventory.rows * this.inventory.cols; i++) {
      bagGrid.appendChild(this._createSlot(i));
    }
    bagSection.appendChild(bagGrid);
    this.container.appendChild(bagSection);
  }

  _createSlot(index) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    slot.dataset.index = index;

    // 快捷栏选中高亮
    if (index === this.inventory.selectedSlot) {
      slot.classList.add('selected');
    }

    const item = this.inventory.slots[index];
    if (item) {
      const icon = document.createElement('div');
      icon.className = 'inv-item-icon';

      if (item.type === 'block') {
        icon.style.background = _getBlockCSSColor(item.blockType);
        icon.title = _getBlockName(item.blockType);
      } else if (item.type === 'weapon') {
        icon.style.background = _getWeaponCSSColor(item.weaponType);
        icon.title = WeaponDefs[item.weaponType]?.name || '武器';
        icon.classList.add('weapon-icon');
      } else if (item.type === 'ammo') {
        icon.style.background = item.ammoType === 'pistol' ? '#FFEB3B' : '#00E5FF';
        icon.title = item.ammoType === 'pistol' ? '手枪弹药' : '步枪弹药';
        icon.classList.add('ammo-icon');
      }

      slot.appendChild(icon);

      // 数量标签
      if (item.count > 1) {
        const count = document.createElement('span');
        count.className = 'inv-count';
        count.textContent = item.count;
        slot.appendChild(count);
      }
    }

    // 点击选择/拖拽
    slot.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.dragFrom === -1) {
        // 开始拖拽
        if (item) {
          this.dragFrom = index;
          slot.classList.add('dragging');
        }
      } else {
        // 完成拖拽：交换
        this.inventory.swapSlots(this.dragFrom, index);
        this.dragFrom = -1;
        this.refresh();
      }
    });

    slot.addEventListener('mouseenter', () => {
      if (this.dragFrom !== -1 && this.dragFrom !== index) {
        slot.classList.add('drag-target');
      }
    });

    slot.addEventListener('mouseleave', () => {
      slot.classList.remove('drag-target');
    });

    return slot;
  }

  /** 打开背包 */
  open() {
    this.isOpen = true;
    this.refresh();
    this.container.style.display = 'flex';
  }

  /** 关闭背包 */
  close() {
    this.isOpen = false;
    this.dragFrom = -1;
    this.container.style.display = 'none';
  }

  /** 切换背包开关 */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /** 刷新背包UI */
  refresh() {
    this._buildUI();
  }
}

/** 方块CSS颜色 */
function _getBlockCSSColor(blockType) {
  const colors = {
    [BlockType.GRASS]: '#4CAF50',
    [BlockType.DIRT]: '#8B6914',
    [BlockType.STONE]: '#808080',
    [BlockType.SAND]: '#DBC67B',
    [BlockType.WOOD]: '#6D4C41',
    [BlockType.LEAVES]: '#2E7D32',
    [BlockType.WATER]: '#2196F3',
    [BlockType.COZE_CYAN]: '#00BCD4',
  };
  return colors[blockType] || '#888';
}

/** 武器CSS颜色 */
function _getWeaponCSSColor(weaponType) {
  const colors = {
    [WeaponType.SWORD]: '#4FC3F7',
    [WeaponType.AXE]: '#8D6E63',
    [WeaponType.PISTOL]: '#FFEB3B',
    [WeaponType.RIFLE]: '#00E5FF',
  };
  return colors[weaponType] || '#888';
}

/** 方块名称 */
function _getBlockName(blockType) {
  const names = {
    [BlockType.GRASS]: '草地',
    [BlockType.DIRT]: '泥土',
    [BlockType.STONE]: '石头',
    [BlockType.SAND]: '沙子',
    [BlockType.WOOD]: '木头',
    [BlockType.LEAVES]: '树叶',
    [BlockType.WATER]: '水',
    [BlockType.COZE_CYAN]: '青色',
  };
  return names[blockType] || '未知';
}
