/**
 * 像素方块世界 - 武器系统
 * 包含：武器定义、弹药系统、子弹系统、近战攻击、第一人称武器渲染、伤害计算、换弹进度
 */
import * as THREE from 'three';
import { BlockType, BlockNames, isSolid, CHUNK_HEIGHT, getBlockColor } from './voxel.js?v=39';

/* ============================================
   武器类型定义
   ============================================ */
export const WeaponType = {
  FIST: 'fist',
  SWORD: 'sword',
  AXE: 'axe',
  PICKAXE: 'pickaxe',
  PISTOL: 'pistol',
  SMG: 'smg',
  SNIPER: 'sniper',
  RIFLE: 'rifle',
  SHOTGUN: 'shotgun',
  GRENADE: 'grenade',
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
    pushback: 0.5,
  },
  [WeaponType.SMG]: {
    name: '冲锋枪',
    type: 'ranged',
    damage: 3,
    range: 40,
    cooldown: 0.1,
    blockDamage: 1,
    bulletSpeed: 100,
    bulletColor: 0x55cc00,
    bulletSize: 0.03,
    recoil: 0.003,
    magSize: 40,
    reloadTime: 1.8,
    ammoType: 'smg',
    spread: 0.04,
    bodyColor: 0x455A64,
    auto: true,
    pushback: 0.3,
  },
  [WeaponType.SNIPER]: {
    name: '狙击枪',
    type: 'ranged',
    damage: 25,
    range: 150,
    cooldown: 1.2,
    blockDamage: 5,
    bulletSpeed: 200,
    bulletColor: 0xE040FB,
    bulletSize: 0.12,
    recoil: 0.08,
    magSize: 5,
    reloadTime: 2.5,
    ammoType: 'sniper',
    spread: 0.002,
    bodyColor: 0x263238,
    pushback: 1.5,
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
    auto: true,
    pushback: 0.5,
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
    pushback: 2.0,
  },
  [WeaponType.GRENADE]: {
    name: '手榴弹',
    type: 'grenade',
    damage: 30,
    range: 30,
    cooldown: 1.5,
    blockDamage: 5,
    blastRadius: 5,
    throwSpeed: 20,
    bodyColor: 0x2E7D32,
    pushback: 0,
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
  constructor(scene, origin, direction, weaponDef, owner, weaponManager) {
    this.scene = scene;
    this.weaponDef = weaponDef;
    this.owner = owner;
    this._weaponManager = weaponManager || null;
    this.alive = true;
    this.age = 0;
    this.maxAge = weaponDef.range / weaponDef.bulletSpeed + 0.5;

    const size = weaponDef.bulletSize || 0.1;
    // 自动武器用更小的子弹，减少视觉混乱
    const actualSize = weaponDef.auto ? size * 0.7 : size;
    const geo = new THREE.BoxGeometry(actualSize, actualSize, actualSize * 2.5);
    const mat = new THREE.MeshBasicMaterial({ color: weaponDef.bulletColor });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(origin);

    this.velocity = direction.clone().multiplyScalar(weaponDef.bulletSpeed);
    this.mesh.lookAt(
      origin.x + direction.x,
      origin.y + direction.y,
      origin.z + direction.z
    );

    // 发光效果（自动武器不添加发光，减少视觉混乱）
    if (!weaponDef.auto) {
      const glowMat = new THREE.MeshBasicMaterial({
        color: weaponDef.bulletColor,
        transparent: true,
        opacity: 0.3,
      });
      const glowGeo = new THREE.BoxGeometry(size * 2.5, size * 2.5, size * 4);
      this.glow = new THREE.Mesh(glowGeo, glowMat);
      this.mesh.add(this.glow);
    }

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
          animal.takeDamage(this.weaponDef.damage, { position: this.mesh.position.clone() }, !!this.weaponDef.auto);
          // 通知武器管理器
          if (this._weaponManager) {
            this._weaponManager._onAnimalHit(animal);
          }
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
    const count = this.weaponDef?.auto ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const size = this.weaponDef?.auto ? (0.03 + Math.random() * 0.03) : (0.06 + Math.random() * 0.06);
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
    // 清理发光子网格
    if (this.glow) {
      if (this.glow.geometry) this.glow.geometry.dispose();
      if (this.glow.material) this.glow.material.dispose();
    }
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
export function spawnHitEffect(scene, position, color, isAuto = false) {
  // 受击粒子爆炸
  const count = isAuto ? 3 : 8;
  for (let i = 0; i < count; i++) {
    const size = isAuto ? (0.02 + Math.random() * 0.03) : (0.05 + Math.random() * 0.06);
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
   手榴弹系统
   ============================================ */
class Grenade {
  constructor(origin, direction, weaponDef, scene, owner, weaponManager) {
    this.weaponDef = weaponDef;
    this.owner = owner;
    this._weaponManager = weaponManager;
    this.scene = scene;
    this.alive = true;
    this.age = 0;
    this.fuseTime = 2.5;

    // 手榴弹模型 - 小球体+引线
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2E7D32 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), bodyMat);
    group.add(body);
    // 引线
    const fuseMat = new THREE.MeshBasicMaterial({ color: 0x8B6914 });
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 4), fuseMat);
    fuse.position.y = 0.12;
    group.add(fuse);
    // 引线头（火星）
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xFF4400 });
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 4), sparkMat);
    spark.position.y = 0.16;
    spark.name = 'spark';
    group.add(spark);

    group.position.copy(origin);
    this.mesh = group;

    // 投掷速度
    this.velocity = direction.clone().multiplyScalar(weaponDef.throwSpeed || 20);
    this.velocity.y += 5;

    scene.add(this.mesh);
  }

  update(dt, world) {
    if (!this.alive) return;

    // 重力
    this.velocity.y -= 20 * dt;

    // 保存旧位置
    const oldPos = this.mesh.position.clone();

    // 移动
    this.mesh.position.add(this.velocity.clone().multiplyScalar(dt));
    this.mesh.rotation.x += dt * 3;
    this.mesh.rotation.z += dt * 2;

    // 方块碰撞检测
    const px = Math.floor(this.mesh.position.x);
    const py = Math.floor(this.mesh.position.y);
    const pz = Math.floor(this.mesh.position.z);

    if (py >= 0 && py < CHUNK_HEIGHT && world) {
      const block = world.getBlock(px, py, pz);
      if (isSolid(block)) {
        // 恢复位置到碰撞前
        this.mesh.position.copy(oldPos);

        // 判断碰撞方向
        const oldPx = Math.floor(oldPos.x);
        const oldPy = Math.floor(oldPos.y);
        const oldPz = Math.floor(oldPos.z);

        if (oldPx !== px) { this.velocity.x *= -0.2; }
        if (oldPz !== pz) { this.velocity.z *= -0.2; }
        if (oldPy !== py) {
          // 落地碰撞 - 弹跳很低
          this.velocity.y *= -0.1;
          this.velocity.x *= 0.4;
          this.velocity.z *= 0.4;
        }

        // 速度很小时直接停止
        if (Math.abs(this.velocity.x) < 0.3) this.velocity.x = 0;
        if (Math.abs(this.velocity.z) < 0.3) this.velocity.z = 0;
        if (Math.abs(this.velocity.y) < 0.3) this.velocity.y = 0;
      }
    }

    // 引线火星闪烁
    const spark = this.mesh.getObjectByName('spark');
    if (spark) {
      spark.visible = Math.sin(this.age * 30) > 0;
    }

    this.age += dt;
    if (this.age >= this.fuseTime) {
      this.explode();
    }
  }

  explode() {
    this.alive = false;
    const pos = this.mesh.position.clone();

    // 从场景移除手榴弹模型
    this.scene.remove(this.mesh);
    this.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });

    // 爆炸粒子效果
    this._spawnExplosionParticles(pos);

    // 爆炸伤害 - 对范围内敌人造成伤害
    const radius = this.weaponDef.blastRadius || 5;
    if (this._weaponManager) {
      this._weaponManager.onAreaDamage?.(pos, this.weaponDef.damage, radius);
    }

    // 爆炸破坏方块
    this._destroyBlocks(pos, radius);

    // 对玩家造成伤害
    if (this.owner) {
      const dist = pos.distanceTo(this.owner.position);
      if (dist < radius) {
        const dmg = Math.round(this.weaponDef.damage * (1 - dist / radius));
        if (dmg > 0 && this._weaponManager) {
          this._weaponManager.onPlayerHurt?.(dmg, pos);
        }
      }
    }

    // 爆炸音效
    if (this._weaponManager) {
      this._weaponManager.onGrenadeExplode?.();
    }
  }

  _spawnExplosionParticles(pos) {
    // 闪光球
    const flashGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    flash._vel = new THREE.Vector3(0, 0, 0);
    flash._life = 0.15;
    flash._isFlash = true;
    this.scene.add(flash);
    if (!this.scene._particles) this.scene._particles = [];
    this.scene._particles.push(flash);

    // 火焰粒子
    const fireCount = 15;
    for (let i = 0; i < fireCount; i++) {
      const color = Math.random() > 0.5 ? 0xFF6D00 : 0xFFAB00;
      const size = 0.06 + Math.random() * 0.08;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);

      const speed = 6;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.6 + 2,
        (Math.random() - 0.5) * speed
      );
      particle._vel = vel;
      particle._life = 0.3 + Math.random() * 0.5;

      this.scene.add(particle);
      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }
    // 灰色碎石粒子
    const debrisCount = 20;
    for (let i = 0; i < debrisCount; i++) {
      const grayTone = 0x444444 + Math.floor(Math.random() * 0x444444);
      const size = 0.05 + Math.random() * 0.1;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color: grayTone, transparent: true, opacity: 1 });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);

      const speed = 8;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.7 + 3,
        (Math.random() - 0.5) * speed
      );
      particle._vel = vel;
      particle._life = 0.4 + Math.random() * 0.8;
      this.scene.add(particle);
      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }
    // 烟雾粒子
    const smokeCount = 12;
    for (let i = 0; i < smokeCount; i++) {
      const size = 0.08 + Math.random() * 0.12;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.7 });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(pos);

      const speed = 4;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.5 + 2,
        (Math.random() - 0.5) * speed
      );
      particle._vel = vel;
      particle._life = 0.6 + Math.random() * 1.0;

      this.scene.add(particle);
      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }
  }

  _destroyBlocks(center, radius) {
    if (this._weaponManager) {
      this._weaponManager.onBlockExplode?.(center, radius, this.weaponDef.blockDamage || 5);
    }
  }
}

/** 手榴弹轨迹预测线 */
export class GrenadeTrajectory {
  constructor(scene) {
    this.scene = scene;
    this.line = null;
    this.points = [];
    this.maxPoints = 30;
  }

  /** 计算并显示抛物线 */
  show(origin, direction, throwSpeed, world) {
    this.hide();

    const vel = direction.clone().multiplyScalar(throwSpeed || 20);
    vel.y += 5;
    const gravity = new THREE.Vector3(0, -20, 0);
    const dt = 0.05;
    const pos = origin.clone();
    const curVel = vel.clone();

    this.points = [];
    for (let i = 0; i < this.maxPoints; i++) {
      this.points.push(pos.clone());
      curVel.add(gravity.clone().multiplyScalar(dt));
      pos.add(curVel.clone().multiplyScalar(dt));
      // 检测方块碰撞
      if (world) {
        const bx = Math.floor(pos.x);
        const by = Math.floor(pos.y);
        const bz = Math.floor(pos.z);
        if (by >= 0 && by < CHUNK_HEIGHT && isSolid(world.getBlock(bx, by, bz))) break;
      }
      if (pos.y < 0) break;
    }

    if (this.points.length < 2) return;

    const geo = new THREE.BufferGeometry().setFromPoints(this.points);
    const mat = new THREE.LineDashedMaterial({
      color: 0x00ff88,
      dashSize: 0.3,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.6,
    });
    this.line = new THREE.Line(geo, mat);
    this.line.computeLineDistances();
    this.scene.add(this.line);
  }

  hide() {
    if (this.line) {
      this.scene.remove(this.line);
      if (this.line.geometry) this.line.geometry.dispose();
      if (this.line.material) this.line.material.dispose();
      this.line = null;
    }
    this.points = [];
  }
}

/** 爆炸音效通知类型 */
export const GrenadeEvent = { EXPLODE: 'grenade_explode' };

/* ============================================
   武器渲染器 - 第一人称手持武器
   ============================================ */
export class WeaponRenderer {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.currentWeapon = WeaponType.FIST;
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.renderOrder = 999;
    this.swingPhase = 0;
    this.recoilPhase = 0;
    this.bobPhase = 0;
    this.swingStartTime = 0;
    this.reloadAnim = 0;       // 0~1 换弹动画进度
    this.isReloading = false;
    this.scopeActive = false;  // 狙击枪瞄准镜状态
    this.placePhase = 0;       // 放置方块动画 0~1
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
    } else if (weaponType === WeaponType.GRENADE) {
      this._buildGrenade(def);
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

  /** 构建手榴弹模型 */
  _buildGrenade(def) {
    const bodyMat = new THREE.MeshLambertMaterial({ color: def.bodyColor || 0x2E7D32 });
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x424242 });
    // 手榴弹主体 - 圆球
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bodyMat);
    body.position.set(0.35, -0.28, -0.48);
    this.weaponGroup.add(body);
    // 顶部拉环柄
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), handleMat);
    lever.position.set(0.35, -0.2, -0.48);
    this.weaponGroup.add(lever);
    // 拉环
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 8), handleMat);
    ring.position.set(0.35, -0.14, -0.48);
    ring.rotation.y = Math.PI / 2;
    this.weaponGroup.add(ring);
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
    } else if (weaponType === WeaponType.SMG) {
      // 冲锋枪 - 紧凑短小，弹鼓
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.32), mat);
      body.position.set(0.35, -0.28, -0.45);
      this.weaponGroup.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.14), accentMat);
      barrel.position.set(0.35, -0.26, -0.62);
      this.weaponGroup.add(barrel);
      // 弹鼓
      const drum = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), new THREE.MeshLambertMaterial({ color: 0x37474F }));
      drum.position.set(0.35, -0.38, -0.44);
      this.weaponGroup.add(drum);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), mat);
      grip.position.set(0.35, -0.37, -0.36);
      grip.rotation.x = 0.2;
      this.weaponGroup.add(grip);
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), glowMat);
      glow.position.set(0.35, -0.26, -0.69);
      this.weaponGroup.add(glow);
    } else if (weaponType === WeaponType.SNIPER) {
      // 狙击枪 - 长管，瞄准镜，支架
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.6), mat);
      body.position.set(0.35, -0.28, -0.58);
      this.weaponGroup.add(body);
      // 长枪管
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.25), accentMat);
      barrel.position.set(0.35, -0.26, -0.9);
      this.weaponGroup.add(barrel);
      // 瞄准镜
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0x1B5E20 }));
      scope.position.set(0.35, -0.2, -0.55);
      this.weaponGroup.add(scope);
      // 镜片
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.01), new THREE.MeshBasicMaterial({ color: 0x00E676 }));
      lens.position.set(0.35, -0.2, -0.5);
      this.weaponGroup.add(lens);
      // 支架
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.15), mat);
      stock.position.set(0.35, -0.3, -0.28);
      this.weaponGroup.add(stock);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), mat);
      grip.position.set(0.35, -0.38, -0.42);
      grip.rotation.x = 0.15;
      this.weaponGroup.add(grip);
      const glowMat = new THREE.MeshBasicMaterial({ color: def.bulletColor });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), glowMat);
      glow.position.set(0.35, -0.26, -1.03);
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

  /** 触发挥砍动画 */
  triggerSwing() {
    this.swingPhase = 1.0;
    this.swingStartTime = performance.now();
  }

  /** 触发放置动画(轻挥) */
  triggerPlace() {
    this.placePhase = 1.0;
  }

  /** 触发后坐力动画 */
  triggerRecoil() {
    this.recoilPhase = 1.0;
  }

  /** 设置瞄准镜状态 */
  setScopeActive(active) {
    this.scopeActive = active;
  }

  /** 每帧更新武器动画 */
  update(dt, isMoving, bobIntensity) {
    if (isMoving) {
      this.bobPhase += dt * 8;
    } else {
      this.bobPhase += dt * 1.5;
    }
    const bobX = Math.sin(this.bobPhase) * (isMoving ? 0.015 : 0.003) * bobIntensity;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * (isMoving ? 0.012 : 0.002) * bobIntensity;

    if (this.swingPhase > 0) {
      this.swingPhase = Math.max(0, this.swingPhase - dt * 5);
    }

    if (this.recoilPhase > 0) {
      this.recoilPhase = Math.max(0, this.recoilPhase - dt * 8);
    }

    // 放置方块动画衰减
    if (this.placePhase > 0) {
      this.placePhase = Math.max(0, this.placePhase - dt * 6);
    }

    // 换弹动画进度递减
    if (this.isReloading) {
      this.reloadAnim = Math.min(1, this.reloadAnim + dt * 2.5);
    } else {
      this.reloadAnim = Math.max(0, this.reloadAnim - dt * 4);
    }

    // 增强的挥砍动画 - 剑类武器大幅度横劈
    const isSword = this.currentWeapon === WeaponType.SWORD;
    const isMelee = [WeaponType.FIST, WeaponType.SWORD, WeaponType.AXE, WeaponType.PICKAXE].includes(this.currentWeapon);

    let swingAngle, swingRotZ;
    if (isSword && this.swingPhase > 0) {
      const t = 1 - this.swingPhase;
      swingAngle = Math.sin(t * Math.PI) * Math.PI * 0.9;
      swingRotZ = Math.sin(t * Math.PI) * 0.5;
    } else if (isMelee && this.swingPhase > 0) {
      swingAngle = this.swingPhase * Math.PI * 0.6;
      swingRotZ = -this.swingPhase * 0.3;
    } else {
      swingAngle = 0;
      swingRotZ = 0;
    }

    const recoilAmount = WeaponDefs[this.currentWeapon]?.recoil || 0.05;
    const recoilZ = this.recoilPhase * recoilAmount;

    // 放置方块动画：向前伸出 → 归位
    let placeOffsetZ = 0;
    let placeRotX = 0;
    if (this.placePhase > 0) {
      const t = 1 - this.placePhase;
      placeOffsetZ = Math.sin(t * Math.PI) * 0.15;
      placeRotX = -Math.sin(t * Math.PI) * 0.3;
    }

    // 换弹动画：武器下沉 → 弹匣弹出 → 装填 → 归位
    let reloadOffsetY = 0;
    let reloadOffsetZ = 0;
    let reloadRotX = 0;
    if (this.reloadAnim > 0) {
      const t = this.reloadAnim;
      if (t < 0.3) {
        // 阶段1：武器下沉
        const p = t / 0.3;
        reloadOffsetY = -p * 0.15;
        reloadRotX = p * 0.4;
      } else if (t < 0.6) {
        // 阶段2：弹匣弹出（快速下移）
        const p = (t - 0.3) / 0.3;
        reloadOffsetY = -0.15 - p * 0.1;
        reloadOffsetZ = p * 0.05;
        reloadRotX = 0.4 + p * 0.2;
      } else {
        // 阶段3：装填归位
        const p = (t - 0.6) / 0.4;
        const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
        reloadOffsetY = -0.25 * (1 - ease);
        reloadOffsetZ = 0.05 * (1 - ease);
        reloadRotX = 0.6 * (1 - ease);
      }
    }

    // 狙击枪瞄准镜时减少摆动
    const scopeFactor = this.scopeActive ? 0.1 : 1.0;

    this.weaponGroup.position.set(
      bobX * scopeFactor,
      bobY * scopeFactor + reloadOffsetY - recoilZ * 0.3,
      -recoilZ + reloadOffsetZ + placeOffsetZ
    );
    this.weaponGroup.rotation.set(
      -swingAngle * 0.5 + reloadRotX + placeRotX,
      0,
      swingRotZ || -swingAngle * 0.3
    );

    if (!this.weaponGroup.parent) {
      this.camera.add(this.weaponGroup);
    }
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

    // 命中回调（由Game设置）
    this.onEnemyHit = null;   // (animal) => void
    this.onEnemyKill = null;  // (animal) => void

    // 弹药系统
    this.currentAmmo = {};   // 武器类型 -> 当前弹匣剩余
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;

    // 连续射击（自动武器）
    this.isFiring = false;   // 左键是否按住
    this.reloadingWeaponType = null;

    // 初始化弹匣
    for (const [key, def] of Object.entries(WeaponDefs)) {
      if (def.type === 'ranged' && def.magSize) {
        this.currentAmmo[key] = def.magSize;
      }
    }

    // 手榴弹数量
    this.grenadeCount = 5;

    // 活跃子弹列表
    this.bullets = [];

    // 活跃手榴弹列表
    this.grenades = [];

    // 初始化粒子列表
    if (!this.scene._particles) this.scene._particles = [];

    // 设置默认武器
    this.renderer.setWeapon(WeaponType.FIST);

    // 换弹进度回调
    this.onReloadProgress = null;
    this.onReloadComplete = null;
    this.onAmmoChanged = null;
  }

  /** 子弹命中生物时调用 */
  _onAnimalHit(animal) {
    if (this.onEnemyHit) this.onEnemyHit(animal);
    if (!animal.alive && this.onEnemyKill) this.onEnemyKill(animal);
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

  /** 射击（从game.js调用），返回true表示成功 */
  shoot(weaponType, player) {
    if (this.cooldownTimer > 0) return false;
    if (this.isReloading) return false;

    const def = WeaponDefs[weaponType];
    if (!def || def.type !== 'ranged') return false;

    // 检查弹匣
    const ammo = this.currentAmmo[weaponType] ?? 0;
    if (ammo <= 0) {
      this.startReload(weaponType);
      return false;
    }

    this.currentWeapon = weaponType;
    this.renderer.setWeapon(weaponType);
    this.cooldownTimer = def.cooldown;

    // 消耗弹药
    this.currentAmmo[weaponType] = ammo - 1;
    this.onAmmoChanged?.();

    // 视觉后坐力回调（相机抖动）
    this.onShootRecoil?.(def.recoil || 0.05);

    // 霰弹枪散射
    const pellets = def.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      this._rangedAttack(def, player.yaw, player.pitch);
    }

    // 弹匣打空自动换弹
    if (this.currentAmmo[weaponType] <= 0) {
      this.startReload(weaponType);
    }

    return true;
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

  /** 投掷手榴弹 */
  throwGrenade(player) {
    if (this.cooldownTimer > 0) return false;
    if (this.grenadeCount <= 0) return false;

    const def = WeaponDefs[WeaponType.GRENADE];
    if (!def) return false;

    this.cooldownTimer = def.cooldown;
    this.grenadeCount--;

    // 计算投掷方向
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    direction.x += Math.sin(player.pitch) * Math.sin(player.yaw) * 0.3;
    direction.z += Math.sin(player.pitch) * Math.cos(player.yaw) * 0.3;
    direction.y = -Math.sin(player.pitch) * 0.5;
    direction.normalize();

    const origin = player.position.clone();
    origin.y += 1.5; // 从玩家头部位置投出

    const grenade = new Grenade(origin, direction, def, this.scene, player, this);
    this.grenades.push(grenade);

    // 挥投动画
    this.renderer.triggerSwing();

    this.onAmmoChanged?.();
    return true;
  }

  /** 放置方块时触发手部动画 */
  triggerPlace() {
    this.renderer.triggerPlace();
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
    if (this.onRecoil) this.onRecoil(def.recoil);

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
            animal.takeDamage(def.damage, { position: this.camera.position.clone() }, !!def.auto);
            this.onEnemyHit?.(animal);
            if (!animal.alive) this.onEnemyKill?.(animal);
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

    const bullet = new Bullet(this.scene, origin, dir, def, 'player', this);
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
  update(dt, isMoving, bobIntensity) {
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

    // 更新手榴弹
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const grenade = this.grenades[i];
      grenade.update(dt, this.world);
      if (!grenade.alive) {
        this.grenades.splice(i, 1);
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
        if (p._isFlash) {
          // 闪光球：缩小并消失
          const s = Math.max(0.01, p._life / 0.15);
          p.scale.set(s, s, s);
          p.material.opacity = s;
        } else {
          p.material.opacity = Math.max(0, p._life * 2);
        }
        p.material.transparent = true;
      }
    }

    // 更新武器渲染
    this.renderer.update(dt, isMoving, bobIntensity || 1.0);
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
    // 快捷栏 0-5: 武器 (对应数字键 1-6)
    this.slots[0] = { type: 'weapon', weaponType: WeaponType.FIST, count: 1 };
    this.slots[1] = { type: 'weapon', weaponType: WeaponType.SWORD, count: 1 };
    this.slots[2] = { type: 'weapon', weaponType: WeaponType.PISTOL, count: 1 };
    this.slots[3] = { type: 'weapon', weaponType: WeaponType.SNIPER, count: 1 };
    this.slots[4] = { type: 'weapon', weaponType: WeaponType.SMG, count: 1 };
    this.slots[5] = { type: 'weapon', weaponType: WeaponType.SHOTGUN, count: 1 };
    // 快捷栏 6: 手榴弹
    this.slots[6] = { type: 'weapon', weaponType: WeaponType.GRENADE, count: 5 };
    // 快捷栏 7-8: 方块
    this.slots[7] = { type: 'block', blockType: BlockType.GRASS, count: 64 };
    this.slots[8] = { type: 'block', blockType: BlockType.STONE, count: 64 };
    // 背包 (第二行起)
    this.slots[9] = { type: 'weapon', weaponType: WeaponType.AXE, count: 1 };
    this.slots[10] = { type: 'weapon', weaponType: WeaponType.PICKAXE, count: 1 };
    this.slots[11] = { type: 'weapon', weaponType: WeaponType.RIFLE, count: 1 };
    this.slots[12] = { type: 'block', blockType: BlockType.WOOD, count: 64 };
    this.slots[13] = { type: 'block', blockType: BlockType.DIRT, count: 64 };
    this.slots[13] = { type: 'block', blockType: BlockType.SAND, count: 64 };
    this.slots[14] = { type: 'block', blockType: BlockType.LEAVES, count: 64 };
    this.slots[15] = { type: 'ammo', ammoType: 'pistol', count: 120 };
    this.slots[16] = { type: 'ammo', ammoType: 'smg', count: 300 };
    this.slots[17] = { type: 'ammo', ammoType: 'sniper', count: 30 };
    this.slots[18] = { type: 'ammo', ammoType: 'rifle', count: 300 };
    this.slots[19] = { type: 'ammo', ammoType: 'shotgun', count: 60 };
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

  /** 添加弹药 */
  addAmmo(pistolAmmo, rifleAmmo, shotgunAmmo, smgAmmo, sniperAmmo) {
    const ammoTypes = [
      { type: 'pistol', count: pistolAmmo },
      { type: 'rifle', count: rifleAmmo },
      { type: 'shotgun', count: shotgunAmmo },
      { type: 'smg', count: smgAmmo || 0 },
      { type: 'sniper', count: sniperAmmo || 0 },
    ];
    for (const a of ammoTypes) {
      if (a.count <= 0) continue;
      // 找已有的弹药槽
      let found = false;
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        if (slot && slot.type === 'ammo' && slot.ammoType === a.type) {
          slot.count += a.count;
          found = true;
          break;
        }
      }
      if (!found) {
        // 找空槽
        for (let i = 0; i < this.slots.length; i++) {
          if (!this.slots[i]) {
            this.slots[i] = { type: 'ammo', ammoType: a.type, count: a.count };
            break;
          }
        }
      }
    }
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

    // 使用已有的HTML元素，不重复创建
    this.screen = document.getElementById('inventoryScreen');
    this.panel = document.getElementById('inventoryPanel');
    this.grid = document.getElementById('inventoryGrid');

    // 如果没有现有元素，创建一个
    if (!this.screen) {
      this.screen = document.createElement('div');
      this.screen.id = 'inventoryScreen';
      this.screen.style.display = 'none';
      document.body.appendChild(this.screen);
    }
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'inventoryPanel';
      this.screen.appendChild(this.panel);
    }
    if (!this.grid) {
      this.grid = document.createElement('div');
      this.grid.id = 'inventoryGrid';
      this.panel.appendChild(this.grid);
    }

    this._buildUI();
  }

  _buildUI() {
    this.panel.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = '背包';
    this.panel.appendChild(title);

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
      hotbarGrid.appendChild(this._createSlot(i, true));
    }
    hotbarSection.appendChild(hotbarGrid);
    this.panel.appendChild(hotbarSection);

    // 背包区域
    const bpSection = document.createElement('div');
    bpSection.className = 'inv-section';
    const bpLabel = document.createElement('div');
    bpLabel.className = 'inv-section-label';
    bpLabel.textContent = '背包';
    bpSection.appendChild(bpLabel);

    const bpGrid = document.createElement('div');
    bpGrid.className = 'inv-grid inv-backpack-grid';
    for (let i = this.inventory.cols; i < this.inventory.slots.length; i++) {
      bpGrid.appendChild(this._createSlot(i, false));
    }
    bpSection.appendChild(bpGrid);
    this.panel.appendChild(bpSection);

    // 关闭提示
    const closeHint = document.createElement('div');
    closeHint.className = 'inv-close-hint';
    closeHint.textContent = '点击物品选中，再点击另一个位置交换 | 按 E/B/ESC 关闭';
    this.panel.appendChild(closeHint);
  }

  _createSlot(index, isHotbar) {
    const slot = document.createElement('div');
    slot.className = `inv-slot${isHotbar ? ' hotbar-slot-inv' : ''}`;
    slot.dataset.index = index;

    const item = this.inventory.slots[index];
    if (item) {
      // 彩色预览块
      const preview = document.createElement('div');
      preview.className = 'inv-preview';
      const color = this._itemColor(item);
      preview.style.background = color;
      preview.style.boxShadow = `0 0 6px ${color}, inset -2px -2px 0 rgba(0,0,0,0.25), inset 2px 2px 0 rgba(255,255,255,0.15)`;
      slot.appendChild(preview);

      // 物品名称
      const name = document.createElement('div');
      name.className = 'inv-name';
      name.textContent = this._itemLabel(item);
      slot.appendChild(name);

      // 数量
      if (item.count > 1) {
        const countEl = document.createElement('span');
        countEl.className = 'inv-count';
        countEl.textContent = item.count;
        slot.appendChild(countEl);
      }
    }

    // 选中高亮
    if (this.dragFrom === index) {
      slot.classList.add('inv-selected');
    }

    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.dragFrom >= 0 && this.dragFrom !== index) {
        this.inventory.swapSlots(this.dragFrom, index);
        this.dragFrom = -1;
        this._buildUI();
      } else if (this.dragFrom === index) {
        this.dragFrom = -1;
        this._buildUI();
      } else {
        this.dragFrom = index;
        this._buildUI();
      }
    });

    return slot;
  }

  _itemColor(item) {
    if (item.type === 'block') {
      return `#${(getBlockColor(item.blockType) || '#888888').replace('#', '')}`;
    }
    if (item.type === 'weapon') {
      const wDef = WeaponDefs[item.weaponType];
      const c = wDef ? (wDef.bodyColor || wDef.bulletColor || 0x888888) : 0x888888;
      return `#${c.toString(16).padStart(6, '0')}`;
    }
    if (item.type === 'ammo') {
      const colors = { pistol: '#FFEB3B', rifle: '#00E5FF', shotgun: '#FF6D00', smg: '#76FF03', sniper: '#E040FB' };
      return colors[item.ammoType] || '#888';
    }
    return '#888';
  }

  _itemLabel(item) {
    if (item.type === 'block') return BlockNames[item.blockType] || '?';
    if (item.type === 'weapon') return WeaponDefs[item.weaponType]?.name || '?';
    if (item.type === 'ammo') {
      const names = { pistol: '手枪弹', rifle: '步枪弹', shotgun: '霰弹', smg: '冲锋枪弹', sniper: '狙击弹' };
      return names[item.ammoType] || '弹药';
    }
    return '?';
  }

  open() {
    this.isOpen = true;
    this._buildUI();
    this.screen.style.display = 'flex';
  }

  close() {
    this.isOpen = false;
    this.dragFrom = -1;
    this.screen.style.display = 'none';
  }
}
