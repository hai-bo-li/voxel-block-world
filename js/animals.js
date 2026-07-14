/**
 * 像素方块世界 - 机器人实体系统
 * 包含：ScoutBot（轻型侦察机器人）、HeavyBot（重型机器人）的体素模型、
 * HP系统、血条、AI行为（巡逻/追踪/攻击）、受击特效、死亡逻辑
 */
import * as THREE from 'three';
import { BlockType, isSolid } from './voxel.js?v=47';
import { spawnHitEffect, computeKnockback } from './weapons.js?v=47';
import { audio } from './audio.js?v=47';

/* ============================================
   常量配置
   ============================================ */
const SCOUT_COUNT = 5;
const HEAVY_COUNT = 3;
const MOBILE_SCOUT_COUNT = 2;
const MOBILE_HEAVY_COUNT = 1;
const SPAWN_RADIUS = 25;
const MIN_SPAWN_DIST = 4;
const WANDER_RANGE = 20;

// AI 常量
const DETECTION_RANGE = 25;        // 检测玩家的距离
const ATTACK_RANGE_MELEE = 2.0;    // 近战攻击距离
const ATTACK_RANGE_RANGED = 20;    // 远程攻击距离
const CHASE_SPEED_MULT = 1.8;      // 追击速度倍率
const ATTACK_COOLDOWN_MELEE = 1.2; // 近战冷却
const ATTACK_COOLDOWN_RANGED = 2.0;// 远程冷却
const DAMAGE_MELEE_SCOUT = 3;      // 侦察机器人近战伤害
const DAMAGE_MELEE_HEAVY = 8;      // 重型机器人近战伤害
const DAMAGE_RANGED_HEAVY = 5;     // 重型机器人远程伤害
const KNOCKBACK_STRENGTH = 4;      // 击退力度

/* ============================================
   工具函数
   ============================================ */
function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function seedRand(x, z) {
  let h = (x * 374761393 + z * 668265263) ^ 1274126177;
  h = ((h ^ (h >> 13)) * 1274126177);
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

/* ============================================
   机器人基类
   ============================================ */
class Robot {
  constructor(scene, world, x, y, z) {
    this.scene = scene;
    this.world = world;
    this.position = new THREE.Vector3(x, y, z);
    this.rotation = randRange(0, Math.PI * 2);
    this.targetRotation = this.rotation;

    // 碰撞体
    this.collisionWidth = 0.7;
    this.collisionHeight = 0.9;

    // HP系统
    this.maxHP = 30;
    this.hp = this.maxHP;
    this.alive = true;

    // 受击效果
    this.hitFlashTimer = 0;
    this.knockbackVel = new THREE.Vector3(0, 0, 0);
    this.verticalVel = 0;           // 垂直速度（重力用）
    this.gravity = -25;             // 重力加速度

    // AI 状态
    this.state = 'idle';       // idle, wander, chase, attack
    this.stateTimer = randRange(1, 3);
    this.wanderDir = new THREE.Vector3(0, 0, 1);
    this.wanderSpeed = 1.5;
    this.turnSpeed = 3.0;
    this.bobPhase = Math.random() * Math.PI * 2;

    // 攻击系统
    this.attackCooldown = 0;
    this.attackType = 'melee'; // 'melee' 或 'ranged'
    this.attackDamage = 3;
    this.attackRange = ATTACK_RANGE_MELEE;

    // 目标玩家引用（由 AnimalManager 设置）
    this.targetPlayer = null;

    // Three.js 群组
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.rotation.y = this.rotation;
    this.scene.add(this.group);

    // 动画部件
    this._animParts = [];

    // 血条
    this._healthBar = null;
    this._buildHealthBar();
  }

  _buildModel() {}

  /** 创建头顶血条 */
  _buildHealthBar() {
    const barGroup = new THREE.Group();

    // 血条背景
    const bgGeo = new THREE.PlaneGeometry(0.8, 0.08);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    barGroup.add(bg);

    // 血条前景
    const fgGeo = new THREE.PlaneGeometry(0.76, 0.05);
    const fgMat = new THREE.MeshBasicMaterial({ color: 0x4CAF50, side: THREE.DoubleSide });
    const fg = new THREE.Mesh(fgGeo, fgMat);
    fg.position.z = 0.001;
    barGroup.add(fg);

    this._healthBarFill = fg;
    this._healthBarFillScale = 0.76;

    // 血条放在头顶
    barGroup.position.y = 1.6;
    this.group.add(barGroup);
    this._healthBar = barGroup;
  }

  /** 更新血条显示 */
  _updateHealthBar() {
    if (!this._healthBarFill) return;
    const ratio = Math.max(0, this.hp / this.maxHP);
    this._healthBarFill.scale.x = ratio;
    this._healthBarFill.position.x = -(1 - ratio) * 0.38;

    // 血量颜色变化
    if (ratio > 0.6) {
      this._healthBarFill.material.color.setHex(0x4CAF50); // 绿
    } else if (ratio > 0.3) {
      this._healthBarFill.material.color.setHex(0xFF9800); // 橙
    } else {
      this._healthBarFill.material.color.setHex(0xF44336); // 红
    }
  }

  /** 血条始终面朝相机 */
  _faceHealthBarToCamera() {
    if (!this._healthBar || !this.scene.userData.camera) return;
    const cam = this.scene.userData.camera;
    const worldPos = new THREE.Vector3();
    this._healthBar.getWorldPosition(worldPos);
    this._healthBar.lookAt(cam.position);
  }

  /** 受击 */
  takeDamage(amount, source, isAuto = false, isExplosion = false) {
    if (!this.alive) return;

    this.hp -= amount;

    // 受击闪烁效果
    this.hitFlashTimer = 0.15;

    // 击退（包含向上的分量）
    if (source && source.position) {
      const strength = isExplosion ? 12 : KNOCKBACK_STRENGTH;
      const kb = computeKnockback(this.position, source.position, strength);
      this.knockbackVel.copy(kb);
      this.verticalVel = isExplosion ? 10 : 5; // 爆炸击飞更高
    }

    // 受击粒子
    const hitPos = this.position.clone();
    hitPos.y += 0.5;
    spawnHitEffect(this.scene, hitPos, 0xFF4444, isAuto);

    // 被攻击时进入追踪状态
    if (this.state === 'idle' || this.state === 'wander') {
      this.state = 'chase';
      this.stateTimer = 5;
    }

    this._updateHealthBar();

    if (this.hp <= 0) {
      this.die();
    }
  }

  /** 死亡 */
  die() {
    this.alive = false;
    this.hp = 0;

    // 击杀音效
    audio.kill();

    // 死亡粒子爆炸
    const colors = [0xB0B8C0, 0xFF4444, 0x4A90D9, 0x3A3E44];
    for (let i = 0; i < 20; i++) {
      const size = 0.06 + Math.random() * 0.12;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 1,
      });
      const particle = new THREE.Mesh(geo, mat);
      particle.position.copy(this.position);
      particle.position.y += 0.5;
      this.scene.add(particle);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6 + 2,
        (Math.random() - 0.5) * 8
      );
      particle._vel = vel;
      particle._life = 0.5 + Math.random() * 0.5;

      if (!this.scene._particles) this.scene._particles = [];
      this.scene._particles.push(particle);
    }

    // 移除模型
    this.dispose();
  }

  get footY() {
    return this.position.y;
  }

  _getGroundY(wx, wz) {
    for (let wy = 48 - 1; wy >= 0; wy--) {
      const block = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(block) && block !== BlockType.LEAVES) {
        return wy + 1;
      }
    }
    return 0;
  }

  _isBlocked(wx, wy, wz) {
    const hw = this.collisionWidth / 2;
    const hh = this.collisionHeight;
    for (let bx = Math.floor(wx - hw); bx <= Math.floor(wx + hw); bx++) {
      for (let by = Math.floor(wy); by < Math.floor(wy + hh); by++) {
        for (let bz = Math.floor(wz - hw); bz <= Math.floor(wz + hw); bz++) {
          const block = this.world.getBlock(bx, by, bz);
          if (isSolid(block) && block !== BlockType.LEAVES) {
            return true;
          }
        }
      }
    }
    return false;
  }

  _isSafeStep(wx, wy, wz) {
    const below = this.world.getBlock(Math.floor(wx), Math.floor(wy) - 1, Math.floor(wz));
    if (!isSolid(below) || below === BlockType.LEAVES) return false;
    const atFeet = this.world.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz));
    if (atFeet === BlockType.WATER) return false;
    const groundAhead = this._getGroundY(wx, wz);
    if (Math.abs(groundAhead - wy) > 2) return false;
    if (this._isBlocked(wx, wy, wz)) return false;
    return true;
  }

  _animateLimbs(dt) {
    if (this._animParts.length === 0) return;
    const swingAngle = Math.sin(this.bobPhase) * 0.45;
    for (let i = 0; i < this._animParts.length; i++) {
      const part = this._animParts[i];
      const phaseSign = (i % 2 === 0) ? 1 : -1;
      part.rotation.x = swingAngle * phaseSign;
    }
  }

  _resetLimbs() {
    for (const part of this._animParts) {
      part.rotation.x *= 0.85;
    }
  }

  /** 获取与玩家的距离 */
  _getDistanceToPlayer() {
    if (!this.targetPlayer) return Infinity;
    return this.position.distanceTo(this.targetPlayer.position);
  }

  /** 获取朝向玩家的方向 */
  _getDirToPlayer() {
    if (!this.targetPlayer) return new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3().subVectors(this.targetPlayer.position, this.position);
    dir.y = 0;
    return dir.normalize();
  }

  update(dt, spawnCenter) {
    if (!this.alive) return;

    dt = Math.min(dt, 0.1);
    this.stateTimer -= dt;
    this.bobPhase += dt * (this.state === 'wander' || this.state === 'chase' ? 5 : 1.5);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // 受击闪烁效果
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      this.group.traverse(child => {
        if (child.isMesh && child.material && child.material.type === 'MeshLambertMaterial') {
          if (this.hitFlashTimer > 0) {
            child.material.emissive.setHex(0xFFFFFF);
          } else {
            child.material.emissive.setHex(0x000000);
          }
        }
      });
    }

    // 击退物理 + 重力
    const groundY = this._getGroundY(this.position.x, this.position.z);
    const isOnGround = this.position.y <= groundY + 0.1;

    if (this.knockbackVel.lengthSq() > 0.01 || !isOnGround) {
      // 水平击退
      this.position.x += this.knockbackVel.x * dt;
      this.position.z += this.knockbackVel.z * dt;
      this.knockbackVel.x *= 0.9;
      this.knockbackVel.z *= 0.9;

      // 垂直运动（重力）
      this.verticalVel += this.gravity * dt;
      this.position.y += this.verticalVel * dt;

      // 落地检测
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVel = 0;
        if (this.knockbackVel.lengthSq() < 0.05) {
          this.knockbackVel.set(0, 0, 0);
        }
      }
    } else {
      // 确保贴地
      this.position.y = groundY;
      this.verticalVel = 0;
      this.knockbackVel.set(0, 0, 0);
    }

    // AI 状态机
    switch (this.state) {
      case 'idle':
        this._updateIdle(dt, spawnCenter);
        this._resetLimbs();
        break;
      case 'wander':
        this._updateWander(dt, spawnCenter);
        this._animateLimbs(dt);
        break;
      case 'chase':
        this._updateChase(dt, spawnCenter);
        this._animateLimbs(dt);
        break;
      case 'attack':
        this._updateAttack(dt, spawnCenter);
        this._resetLimbs();
        break;
    }

    // 自动检测玩家
    const distToPlayer = this._getDistanceToPlayer();
    if (this.state === 'idle' || this.state === 'wander') {
      if (distToPlayer < DETECTION_RANGE) {
        this.state = 'chase';
        this.stateTimer = 8;
      }
    }

    // 平滑旋转
    const rDiff = this.targetRotation - this.rotation;
    let shortDiff = ((rDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.rotation += shortDiff * Math.min(this.turnSpeed * dt, 1);
    this.group.rotation.y = this.rotation;

    // 上下轻微摆动
    const bob = (this.state === 'wander' || this.state === 'chase') ? Math.sin(this.bobPhase) * 0.04 : 0;
    this.group.position.set(this.position.x, this.position.y + bob, this.position.z);

    this._animateAntenna(dt);
    this._faceHealthBarToCamera();
  }

  _animateAntenna(dt) {}

  _updateIdle(dt, spawnCenter) {
    if (Math.random() < dt * 0.5) {
      this.targetRotation += randRange(-0.5, 0.5);
    }
    if (this.stateTimer <= 0) {
      this.state = 'wander';
      this.stateTimer = randRange(2, 5);
      this.wanderDir.set(
        Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)
      ).normalize();
    }
  }

  _updateWander(dt, spawnCenter) {
    const step = this.wanderSpeed * dt;
    const nx = this.position.x + this.wanderDir.x * step;
    const nz = this.position.z + this.wanderDir.z * step;
    const ny = this._getGroundY(nx, nz);

    const distFromCenter = Math.sqrt(
      (nx - spawnCenter.x) ** 2 + (nz - spawnCenter.z) ** 2
    );

    if (this._isSafeStep(nx, ny, nz) && distFromCenter < WANDER_RANGE) {
      this.position.x = nx;
      this.position.z = nz;
      this.position.y = ny;
      this.targetRotation = Math.atan2(this.wanderDir.z, this.wanderDir.x);
    } else {
      this.targetRotation += randRange(Math.PI * 0.4, Math.PI * 0.8) * (Math.random() > 0.5 ? 1 : -1);
      this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)).normalize();
      this.stateTimer = Math.max(this.stateTimer, 0.5);
    }

    if (Math.random() < dt * 0.3) {
      this.targetRotation += randRange(-0.8, 0.8);
      this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)).normalize();
    }

    if (this.stateTimer <= 0) {
      this.state = 'idle';
      this.stateTimer = randRange(1, 4);
    }
  }

  /** 追击玩家状态 */
  _updateChase(dt, spawnCenter) {
    const distToPlayer = this._getDistanceToPlayer();

    // 超出检测范围则放弃追击
    if (distToPlayer > DETECTION_RANGE * 1.5) {
      this.state = 'wander';
      this.stateTimer = randRange(2, 4);
      this.wanderDir.set(
        Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)
      ).normalize();
      return;
    }

    // 进入攻击范围
    if (distToPlayer < this.attackRange) {
      this.state = 'attack';
      this.stateTimer = 0.5;
      return;
    }

    // 朝玩家移动
    const dirToPlayer = this._getDirToPlayer();
    const speed = this.wanderSpeed * CHASE_SPEED_MULT;
    const step = speed * dt;
    const nx = this.position.x + dirToPlayer.x * step;
    const nz = this.position.z + dirToPlayer.z * step;
    const ny = this._getGroundY(nx, nz);

    if (this._isSafeStep(nx, ny, nz)) {
      this.position.x = nx;
      this.position.z = nz;
      this.position.y = ny;
    }

    // 面朝玩家
    this.targetRotation = Math.atan2(dirToPlayer.z, dirToPlayer.x);

    // 追击超时回到巡逻
    if (this.stateTimer <= 0) {
      this.state = 'wander';
      this.stateTimer = randRange(2, 4);
    }
  }

  /** 攻击状态 */
  _updateAttack(dt, spawnCenter) {
    const distToPlayer = this._getDistanceToPlayer();

    // 超出攻击范围回到追击
    if (distToPlayer > this.attackRange * 1.5) {
      this.state = 'chase';
      this.stateTimer = 5;
      return;
    }

    // 面朝玩家
    const dirToPlayer = this._getDirToPlayer();
    this.targetRotation = Math.atan2(dirToPlayer.z, dirToPlayer.x);

    // 执行攻击
    if (this.attackCooldown <= 0 && this.targetPlayer) {
      this._performAttack();
    }
  }

  /** 执行攻击 - 子类可覆盖 */
  _performAttack() {
    if (!this.targetPlayer) return;

    if (this.attackType === 'melee') {
      const dist = this._getDistanceToPlayer();
      if (dist < ATTACK_RANGE_MELEE) {
        this.attackCooldown = ATTACK_COOLDOWN_MELEE;
        // 对玩家造成伤害
        if (this.targetPlayer.takeDamage) {
          this.targetPlayer.takeDamage(this.attackDamage, this.position);
        }
      }
    } else if (this.attackType === 'ranged') {
      const dist = this._getDistanceToPlayer();
      if (dist < ATTACK_RANGE_RANGED) {
        this.attackCooldown = ATTACK_COOLDOWN_RANGED;
        // 发射远程子弹
        this._fireProjectile();
      }
    }
  }

  /** 远程射击（重型机器人使用） */
  _fireProjectile() {
    if (!this.targetPlayer) return;

    const dir = this._getDirToPlayer();
    const targetPos = this.targetPlayer.position.clone();
    targetPos.y += 1.0; // 瞄准身体中段
    const origin = this.position.clone();
    origin.y += 0.8;
    dir.copy(targetPos.sub(origin).normalize());

    // 创建敌人子弹
    const bulletGeo = new THREE.BoxGeometry(0.08, 0.08, 0.2);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xFF6600 });
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
    bulletMesh.position.copy(origin);
    bulletMesh.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    this.scene.add(bulletMesh);

    // 发光
    const glowGeo = new THREE.BoxGeometry(0.15, 0.15, 0.3);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xFF6600, transparent: true, opacity: 0.4 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    bulletMesh.add(glow);

    const speed = 40;
    const velocity = dir.clone().multiplyScalar(speed);
    const self = this;

    // 敌人子弹数据
    const enemyBullet = {
      mesh: bulletMesh,
      velocity: velocity,
      age: 0,
      maxAge: 3,
      damage: this.attackDamage,
      owner: 'enemy',
      alive: true,

      update(dt) {
        if (!this.alive) return;
        this.age += dt;
        if (this.age > this.maxAge) {
          this.destroy();
          return;
        }

        this.mesh.position.add(this.velocity.clone().multiplyScalar(dt));

        // 检测命中玩家
        if (self.targetPlayer) {
          const dist = this.mesh.position.distanceTo(self.targetPlayer.position);
          if (dist < 1.0) {
            if (self.targetPlayer.takeDamage) {
              self.targetPlayer.takeDamage(this.damage, this.mesh.position);
            }
            this.destroy();
            return;
          }
        }

        // 检测命中方块
        const bx = Math.floor(this.mesh.position.x);
        const by = Math.floor(this.mesh.position.y);
        const bz = Math.floor(this.mesh.position.z);
        if (by >= 0 && by < 48) {
          const block = self.world.getBlock(bx, by, bz);
          if (isSolid(block)) {
            this.destroy();
            return;
          }
        }
      },

      destroy() {
        this.alive = false;
        self.scene.remove(this.mesh);
        if (this.mesh.geometry) this.mesh.geometry.dispose();
        if (this.mesh.material) this.mesh.material.dispose();
      }
    };

    // 添加到场景子弹列表
    if (!this.scene._enemyBullets) this.scene._enemyBullets = [];
    this.scene._enemyBullets.push(enemyBullet);
  }

  dispose() {
    if (this.group) {
      this.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.scene.remove(this.group);
    }
  }
}

/* ============================================
   轻型侦察机器人 (ScoutBot)
   HP低、速度快、近战攻击
   ============================================ */
class ScoutBot extends Robot {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.collisionWidth = 0.7;
    this.collisionHeight = 1.0;
    this.wanderSpeed = 1.4;
    this.turnSpeed = 2.8;
    this.antennaAngle = 0;

    // 侦察机器人属性
    this.maxHP = 30;
    this.hp = 30;
    this.attackType = 'melee';
    this.attackDamage = DAMAGE_MELEE_SCOUT;
    this.attackRange = ATTACK_RANGE_MELEE;

    this._buildModel();
    this._updateHealthBar();
  }

  _buildModel() {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xB0B8C0 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x3A3E44 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x4A90D9 });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xFF4444 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x66D9FF });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), bodyMat);
    body.position.set(0, 0.45, 0);
    this.group.add(body);

    const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.06), accentMat);
    chestPanel.position.set(0, 0.5, 0.48);
    this.group.add(chestPanel);

    const coreLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), eyeMat);
    coreLight.position.set(0, 0.5, 0.52);
    this.group.add(coreLight);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.45), bodyMat);
    head.position.set(0, 0.85, 0.35);
    this.group.add(head);

    const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 0.04), darkMat);
    faceplate.position.set(0, 0.85, 0.58);
    this.group.add(faceplate);

    const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.03);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.1, 0.92, 0.6);
    this.group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.1, 0.92, 0.6);
    this.group.add(eyeR);

    const antennaPole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), darkMat);
    antennaPole.position.set(0, 1.15, 0.3);
    this.group.add(antennaPole);
    const antennaBall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    antennaBall.position.set(0, 1.28, 0.3);
    antennaBall.name = 'antennaBall';
    this.group.add(antennaBall);

    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), darkMat);
    sideL.position.set(0.42, 0.45, 0);
    this.group.add(sideL);
    const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), darkMat);
    sideR.position.set(-0.42, 0.45, 0);
    this.group.add(sideR);

    const legGeo = new THREE.BoxGeometry(0.16, 0.35, 0.16);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x6B7280 });
    const legs = [
      [0.18, 0.17, 0.28], [-0.18, 0.17, 0.28],
      [0.18, 0.17, -0.28], [-0.18, 0.17, -0.28],
    ];
    for (const [lx, ly, lz] of legs) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, ly, lz);
      this.group.add(leg);
      this._animParts.push(leg);
    }
  }

  _animateAntenna(dt) {
    this.antennaAngle += dt * 2;
    const ball = this.group.getObjectByName('antennaBall');
    if (ball) {
      ball.position.x = Math.sin(this.antennaAngle) * 0.04;
    }
  }
}

/* ============================================
   重型机器人 (HeavyBot)
   HP高、速度慢、可远程攻击
   ============================================ */
class HeavyBot extends Robot {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.collisionWidth = 0.85;
    this.collisionHeight = 1.15;
    this.wanderSpeed = 1.0;
    this.turnSpeed = 2.0;
    this.antennaAngle = 0;

    // 重型机器人属性
    this.maxHP = 80;
    this.hp = 80;
    this.attackType = 'ranged';
    this.attackDamage = DAMAGE_RANGED_HEAVY;
    this.attackRange = ATTACK_RANGE_RANGED;

    this._buildModel();
    this._updateHealthBar();
  }

  _buildModel() {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x889098 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2D3136 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xE8833A });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xFFB866 });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xFF3333 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.65, 1.2), bodyMat);
    body.position.set(0, 0.55, 0);
    this.group.add(body);

    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.3), darkMat);
    shoulderL.position.set(0.5, 0.7, 0.2);
    this.group.add(shoulderL);
    const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.3), darkMat);
    shoulderR.position.set(-0.5, 0.7, 0.2);
    this.group.add(shoulderR);

    const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.06), accentMat);
    chestPanel.position.set(0, 0.6, 0.63);
    this.group.add(chestPanel);
    const coreLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), eyeMat);
    coreLight.position.set(0, 0.6, 0.67);
    this.group.add(coreLight);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), bodyMat);
    head.position.set(0, 0.95, 0.45);
    this.group.add(head);

    const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.04), darkMat);
    faceplate.position.set(0, 0.95, 0.71);
    this.group.add(faceplate);

    const eyeGeo = new THREE.BoxGeometry(0.12, 0.1, 0.03);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.12, 1.03, 0.73);
    this.group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.12, 1.03, 0.73);
    this.group.add(eyeR);

    // 炮管（右肩）
    const cannonBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.3), darkMat);
    cannonBase.position.set(0.55, 0.8, 0.35);
    this.group.add(cannonBase);
    const cannonBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.25), accentMat);
    cannonBarrel.position.set(0.55, 0.8, 0.55);
    this.group.add(cannonBarrel);
    // 炮口发光
    const muzzleGlow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xFF6600 }));
    muzzleGlow.position.set(0.55, 0.8, 0.68);
    muzzleGlow.name = 'muzzleGlow';
    this.group.add(muzzleGlow);

    const antGeo = new THREE.BoxGeometry(0.06, 0.28, 0.06);
    const antL = new THREE.Mesh(antGeo, darkMat);
    antL.position.set(0.1, 1.25, 0.4);
    this.group.add(antL);
    const antR = new THREE.Mesh(antGeo, darkMat);
    antR.position.set(-0.1, 1.25, 0.4);
    this.group.add(antR);
    const ballL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    ballL.position.set(0.1, 1.4, 0.4);
    ballL.name = 'antennaBallL';
    this.group.add(ballL);
    const ballR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    ballR.position.set(-0.1, 1.4, 0.4);
    ballR.name = 'antennaBallR';
    this.group.add(ballR);

    const armGeo = new THREE.BoxGeometry(0.18, 0.4, 0.2);
    const armMat = new THREE.MeshLambertMaterial({ color: 0x5A6068 });
    const armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(0.5, 0.5, 0.15);
    this.group.add(armL);
    this._animParts.push(armL);
    const armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(-0.5, 0.5, 0.15);
    this.group.add(armR);
    this._animParts.push(armR);

    const treadGeo = new THREE.BoxGeometry(0.3, 0.25, 0.9);
    const treadMat = new THREE.MeshLambertMaterial({ color: 0x3A3E44 });
    const treadL = new THREE.Mesh(treadGeo, treadMat);
    treadL.position.set(0.3, 0.12, 0);
    this.group.add(treadL);
    const treadR = new THREE.Mesh(treadGeo, treadMat);
    treadR.position.set(-0.3, 0.12, 0);
    this.group.add(treadR);

    for (let i = -2; i <= 2; i++) {
      const detailGeo = new THREE.BoxGeometry(0.34, 0.04, 0.1);
      const detailL = new THREE.Mesh(detailGeo, accentMat);
      detailL.position.set(0.3, 0.02, i * 0.28);
      this.group.add(detailL);
      const detailR = new THREE.Mesh(detailGeo, accentMat);
      detailR.position.set(-0.3, 0.02, i * 0.28);
      this.group.add(detailR);
      const detailTL = new THREE.Mesh(detailGeo, accentMat);
      detailTL.position.set(0.3, 0.24, i * 0.28);
      this.group.add(detailTL);
      const detailTR = new THREE.Mesh(detailGeo, accentMat);
      detailTR.position.set(-0.3, 0.24, i * 0.28);
      this.group.add(detailTR);
    }
  }

  _animateAntenna(dt) {
    this.antennaAngle += dt * 1.8;
    const ballL = this.group.getObjectByName('antennaBallL');
    const ballR = this.group.getObjectByName('antennaBallR');
    const offset = Math.sin(this.antennaAngle) * 0.05;
    if (ballL) ballL.position.x = 0.1 + offset;
    if (ballR) ballR.position.x = -0.1 - offset;
  }
}

/* ============================================
   机器人生成管理器
   ============================================ */
export class AnimalManager {
  constructor(scene, world, isMobile = false) {
    this.scene = scene;
    this.world = world;
    this.isMobile = isMobile;
    this.robots = [];
    this.spawnCenter = new THREE.Vector3(0, 0, 0);
    this._spawned = false;
    this._respawnQueue = [];        // 等待重生的敌人
    this.respawnDelay = 10;         // 死亡后10秒重生
    this.totalKills = 0;            // 总击杀数
  }

  get animals() {
    return this.robots;
  }

  /** 设置目标玩家引用 */
  setPlayer(player) {
    this._player = player;
    for (const robot of this.robots) {
      robot.targetPlayer = player;
    }
  }

  spawnAnimals() {
    if (this._spawned) return;
    this._spawned = true;

    const scoutCount = this.isMobile ? MOBILE_SCOUT_COUNT : SCOUT_COUNT;
    const heavyCount = this.isMobile ? MOBILE_HEAVY_COUNT : HEAVY_COUNT;
    const usedPositions = [];

    const trySpawn = (type) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = randRange(5, SPAWN_RADIUS);
        const sx = this.spawnCenter.x + Math.cos(angle) * dist;
        const sz = this.spawnCenter.z + Math.sin(angle) * dist;

        const groundBlock = this.world.getBlock(
          Math.floor(sx), Math.floor(this._getGroundY(sx, sz) - 1), Math.floor(sz)
        );
        if (groundBlock !== BlockType.GRASS && groundBlock !== BlockType.SAND) continue;

        const gy = this._getGroundY(sx, sz);
        if (gy < 1 || gy > 40) continue;

        let tooClose = false;
        for (const p of usedPositions) {
          const d = Math.sqrt((sx - p.x) ** 2 + (sz - p.z) ** 2);
          if (d < MIN_SPAWN_DIST) { tooClose = true; break; }
        }
        if (tooClose) continue;

        usedPositions.push({ x: sx, z: sz });

        let robot;
        if (type === 'scout') {
          robot = new ScoutBot(this.scene, this.world, sx, gy, sz);
        } else {
          robot = new HeavyBot(this.scene, this.world, sx, gy, sz);
        }
        robot.targetPlayer = this._player || null;
        this.robots.push(robot);
        return;
      }
    };

    for (let i = 0; i < heavyCount; i++) trySpawn('heavy');
    for (let i = 0; i < scoutCount; i++) trySpawn('scout');
  }

  _getGroundY(wx, wz) {
    for (let wy = 48 - 1; wy >= 0; wy--) {
      const block = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(block) && block !== BlockType.LEAVES) {
        return wy + 1;
      }
    }
    return 1;
  }

  update(dt) {
    // 更新存活的机器人
    for (const robot of this.robots) {
      if (robot.alive) {
        robot.update(dt, this.spawnCenter);
      }
    }

    // 将死亡机器人加入重生队列
    const deadRobots = this.robots.filter(r => !r.alive);
    for (const dead of deadRobots) {
      this.totalKills++;
      this._respawnQueue.push({
        timer: this.respawnDelay,
        type: dead instanceof HeavyBot ? 'heavy' : 'scout',
      });
    }
    this.robots = this.robots.filter(r => r.alive);

    // 处理重生队列
    for (let i = this._respawnQueue.length - 1; i >= 0; i--) {
      this._respawnQueue[i].timer -= dt;
      if (this._respawnQueue[i].timer <= 0) {
        this._spawnSingle(this._respawnQueue[i].type);
        this._respawnQueue.splice(i, 1);
      }
    }

    // 更新敌人子弹
    if (this.scene._enemyBullets) {
      for (let i = this.scene._enemyBullets.length - 1; i >= 0; i--) {
        const bullet = this.scene._enemyBullets[i];
        bullet.update(dt);
        if (!bullet.alive) {
          this.scene._enemyBullets.splice(i, 1);
        }
      }
    }
  }

  /** 生成单个敌人 */
  _spawnSingle(type) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = randRange(8, SPAWN_RADIUS);
      const sx = this.spawnCenter.x + Math.cos(angle) * dist;
      const sz = this.spawnCenter.z + Math.sin(angle) * dist;

      const gy = this._getGroundY(sx, sz);
      if (gy < 1 || gy > 40) continue;

      let robot;
      if (type === 'heavy') {
        robot = new HeavyBot(this.scene, this.world, sx, gy, sz);
      } else {
        robot = new ScoutBot(this.scene, this.world, sx, gy, sz);
      }
      robot.targetPlayer = this._player || null;
      this.robots.push(robot);
      return;
    }
  }

  dispose() {
    for (const robot of this.robots) {
      robot.dispose();
    }
    this.robots = [];
  }
}
