/**
 * 像素方块世界 - 游戏主模块
 * 包含：玩家控制（HP+受击）、物理系统、射线检测、武器HUD、游戏循环
 */

import * as THREE from 'three';
import {
  World, Chunk, BlockType, BlockNames, isSolid,
  CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DISTANCE, getBlockColor,
  isMobileDevice, getRenderDistance,
} from './voxel.js?v=49';
import { AnimalManager } from './animals.js?v=49';
import {
  WeaponManager, WeaponRenderer, Inventory, InventoryUI,
  WeaponType, WeaponDefs, getBlockMaxHP, spawnHitEffect, computeKnockback,
  GrenadeTrajectory,
} from './weapons.js?v=49';
import { audio } from './audio.js?v=49';

/* ============================================
   玩家类 - 第一人称角色控制 + HP系统
   ============================================ */
class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;

    // 位置与速度
    this.position = new THREE.Vector3(5.4, -27.0, 22.6);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // 视角旋转
    this.pitch = 0;
    this.yaw = 0;
    this._smoothYaw = 0;
    this._smoothPitch = 0;
    this.sensitivity = 0.0015;     // 降低默认灵敏度（原0.002）
    this.mouseSmoothing = 0.15;    // 鼠标平滑系数（0=无平滑, 1=强平滑）
    this.cameraBobEnabled = true;  // 镜头晃动开关
    this._bobTimer = 0;

    // 物理参数
    this.gravity = -25;
    this.jumpSpeed = 12;
    this.moveSpeed = 5.5;
    this.onGround = false;

    // 玩家碰撞体尺寸
    this.width = 0.6;
    this.height = 1.75;
    this.eyeHeight = 1.6;

    // 输入状态
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this._rawDX = 0;
    this._rawDY = 0;

    // 交互参数
    this.reachDistance = 7;
    this.selectedBlock = BlockType.GRASS;

    // 射线检测结果缓存
    this.targetBlock = null;
    this.targetFace = null;

    // === HP系统 ===
    this.maxHP = 100;
    this.hp = this.maxHP;
    this.alive = true;
    this.hitFlashTimer = 0;
    this.knockbackVel = new THREE.Vector3(0, 0, 0);
    this.invincibleTimer = 0; // 受击无敌时间

    // 回调
    this.onHPChanged = null;
    this.onDeath = null;
  }

  /** 玩家受击 */
  takeDamage(amount, fromPosition, isExplosion = false) {
    if (!this.alive || this.invincibleTimer > 0) return;

    this.hp = Math.max(0, this.hp - amount);
    this.invincibleTimer = 0.3; // 0.3秒无敌
    this.hitFlashTimer = 0.2;
    this._lastDmgFrom = fromPosition ? fromPosition.clone() : null;

    // 击退
    if (fromPosition) {
      const strength = isExplosion ? 10 : 3;
      const kb = computeKnockback(this.position, fromPosition, strength);
      this.knockbackVel.add(kb);
      if (isExplosion) {
        this.velocity.y = 8; // 爆炸击飞
      }
    }

    this.onHPChanged?.(this.hp, this.maxHP);

    if (this.hp <= 0) {
      this.alive = false;
      this.onDeath?.();
    }
  }

  /** 回复生命 */
  heal(amount) {
    this.hp = Math.min(this.maxHP, this.hp + amount);
    this.onHPChanged?.(this.hp, this.maxHP);
  }

  /** 重生 */
  respawn(spawnPos) {
    this.alive = true;
    this.hp = this.maxHP;
    this.position.copy(spawnPos);
    this.velocity.set(0, 0, 0);
    this.knockbackVel.set(0, 0, 0);
    this.invincibleTimer = 2; // 重生无敌2秒
    this.onHPChanged?.(this.hp, this.maxHP);
  }

  /** 处理鼠标移动 - 带平滑 */
  onMouseMove(dx, dy) {
    this._rawDX += dx;
    this._rawDY += dy;
  }

  /** 每帧更新 */
  update(dt) {
    if (!this.alive) return;

    dt = Math.min(dt, 0.05);

    // 无敌时间递减
    this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    // === 鼠标平滑处理 ===
    const smoothFactor = 1 - this.mouseSmoothing;
    this.mouseDX = this._rawDX * smoothFactor;
    this.mouseDY = this._rawDY * smoothFactor;
    this._rawDX *= this.mouseSmoothing;
    this._rawDY *= this.mouseSmoothing;
    if (Math.abs(this._rawDX) < 0.01) this._rawDX = 0;
    if (Math.abs(this._rawDY) < 0.01) this._rawDY = 0;

    this.yaw -= this.mouseDX * this.sensitivity;
    this.pitch -= this.mouseDY * this.sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

    // === 视角平滑插值 ===
    this._smoothYaw += (this.yaw - this._smoothYaw) * Math.min(1, dt * 20);
    this._smoothPitch += (this.pitch - this._smoothPitch) * Math.min(1, dt * 20);

    // 击退物理：作为位移增量，每轴单独走碰撞检测
    if (this.knockbackVel.lengthSq() > 0.01) {
      const kbMove = this.knockbackVel.clone().multiplyScalar(dt);
      // X轴
      this.position.x += kbMove.x;
      this._resolveCollision('x', this.knockbackVel.x);
      // Z轴
      this.position.z += kbMove.z;
      this._resolveCollision('z', this.knockbackVel.z);
      // Y轴
      this.position.y += kbMove.y;
      this._resolveCollision('y', this.knockbackVel.y);
      this.knockbackVel.multiplyScalar(0.85);
      if (this.knockbackVel.lengthSq() < 0.01) {
        this.knockbackVel.set(0, 0, 0);
      }
    }

    // 计算移动方向
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw), 0, -Math.cos(this.yaw)
    ).normalize();

    const right = new THREE.Vector3(
      Math.cos(this.yaw), 0, -Math.sin(this.yaw)
    ).normalize();

    const moveDir = new THREE.Vector3(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(forward);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(right);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    this.velocity.x = moveDir.x * this.moveSpeed;
    this.velocity.z = moveDir.z * this.moveSpeed;

    // 水物理检测
    const footBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y),
      Math.floor(this.position.z)
    );
    const eyeBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + this.eyeHeight),
      Math.floor(this.position.z)
    );
    const inWater = (footBlock === BlockType.WATER || eyeBlock === BlockType.WATER);

    const effectiveGravity = inWater ? this.gravity * 0.15 : this.gravity;
    this.velocity.y += effectiveGravity * dt;

    if (inWater && (this.keys['Space'] || this.keys['KeyK'])) {
      this.velocity.y = 3;
      this.onGround = false;
    }

    if (!inWater && (this.keys['Space'] || this.keys['KeyK']) && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    if (inWater) {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }

    // 碰撞检测
    this.onGround = false;

    this.position.x += this.velocity.x * dt;
    this._resolveCollision('x');

    this.position.y += this.velocity.y * dt;
    this._resolveCollision('y');

    this.position.z += this.velocity.z * dt;
    this._resolveCollision('z');

    if (this.position.y < -10) {
      this.position.y = 50;
      this.velocity.y = 0;
    }

    // 更新相机 - 带镜头晃动
    const isMovingNow = this.keys['KeyW'] || this.keys['KeyA'] || this.keys['KeyS'] || this.keys['KeyD'];
    if (this.cameraBobEnabled && isMovingNow && this.onGround) {
      this._bobTimer += dt * 9;
    } else {
      this._bobTimer += dt * 1.5;
    }
    const bobAmount = (isMovingNow && this.onGround) ? 1 : 0;
    const bobY = Math.sin(this._bobTimer) * 0.04 * bobAmount;
    const bobX = Math.cos(this._bobTimer * 0.5) * 0.02 * bobAmount;

    this.camera.position.set(
      this.position.x + bobX,
      this.position.y + this.eyeHeight + bobY,
      this.position.z
    );

    const lookDir = new THREE.Vector3(
      -Math.sin(this._smoothYaw) * Math.cos(this._smoothPitch),
      Math.sin(this._smoothPitch),
      -Math.cos(this._smoothYaw) * Math.cos(this._smoothPitch)
    );
    this.camera.lookAt(
      this.camera.position.x + lookDir.x,
      this.camera.position.y + lookDir.y,
      this.camera.position.z + lookDir.z
    );

    // 受击红色闪烁效果（通过相机FOV微抖）
    if (this.hitFlashTimer > 0) {
      // 通过屏幕红色叠加表示受击，由game.js中的overlay处理
    }

    this._raycast();
  }

  _resolveCollision(axis, dirOverride) {
    const halfW = this.width / 2;
    const min = new THREE.Vector3(
      this.position.x - halfW, this.position.y, this.position.z - halfW
    );
    const max = new THREE.Vector3(
      this.position.x + halfW, this.position.y + this.height, this.position.z + halfW
    );

    const startX = Math.floor(min.x);
    const endX = Math.floor(max.x);
    const startY = Math.floor(min.y);
    const endY = Math.floor(max.y);
    const startZ = Math.floor(min.z);
    const endZ = Math.floor(max.z);

    for (let bx = startX; bx <= endX; bx++) {
      for (let by = startY; by <= endY; by++) {
        for (let bz = startZ; bz <= endZ; bz++) {
          const blockType = this.world.getBlock(bx, by, bz);
          if (blockType === BlockType.AIR) continue;

          const isWater = blockType === BlockType.WATER;

          if (isWater) {
            if (axis !== 'y' || this.velocity.y >= 0) continue;
            const blockMinW = { x: bx, y: by, z: bz };
            const blockMaxW = { x: bx + 1, y: by + 1, z: bz + 1 };
            if (min.x < blockMaxW.x && max.x > blockMinW.x &&
                min.y < blockMaxW.y && max.y > blockMinW.y &&
                min.z < blockMaxW.z && max.z > blockMinW.z) {
              this.position.y = blockMaxW.y;
              this.velocity.y = 0;
              this.onGround = true;
              min.y = this.position.y;
              max.y = this.position.y + this.height;
            }
            continue;
          }

          const blockMin = { x: bx, y: by, z: bz };
          const blockMax = { x: bx + 1, y: by + 1, z: bz + 1 };

          if (min.x < blockMax.x && max.x > blockMin.x &&
              min.y < blockMax.y && max.y > blockMin.y &&
              min.z < blockMax.z && max.z > blockMin.z) {

            if (axis === 'x') {
              const dirX = dirOverride !== undefined ? dirOverride : this.velocity.x;
              if (dirX > 0) {
                this.position.x = blockMin.x - halfW;
              } else {
                this.position.x = blockMax.x + halfW;
              }
              this.velocity.x = 0;
            } else if (axis === 'y') {
              const dirY = dirOverride !== undefined ? dirOverride : this.velocity.y;
              if (dirY > 0) {
                this.position.y = blockMin.y - this.height;
              } else {
                this.position.y = blockMax.y;
                this.onGround = true;
              }
              this.velocity.y = 0;
            } else if (axis === 'z') {
              const dirZ = dirOverride !== undefined ? dirOverride : this.velocity.z;
              if (dirZ > 0) {
                this.position.z = blockMin.z - halfW;
              } else {
                this.position.z = blockMax.z + halfW;
              }
              this.velocity.z = 0;
            }

            min.x = this.position.x - halfW;
            max.x = this.position.x + halfW;
            min.y = this.position.y;
            max.y = this.position.y + this.height;
            min.z = this.position.z - halfW;
            max.z = this.position.z + halfW;
          }
        }
      }
    }
  }

  _raycast() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    this.targetBlock = null;
    this.targetFace = null;

    const step = 0.05;
    const maxSteps = this.reachDistance / step;
    let prevX = Math.floor(origin.x);
    let prevY = Math.floor(origin.y);
    let prevZ = Math.floor(origin.z);

    for (let i = 0; i < maxSteps; i++) {
      const t = i * step;
      const x = Math.floor(origin.x + direction.x * t);
      const y = Math.floor(origin.y + direction.y * t);
      const z = Math.floor(origin.z + direction.z * t);

      if (x === prevX && y === prevY && z === prevZ) continue;

      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        this.targetBlock = { x, y, z, type: block };
        this.targetFace = {
          x: prevX - x,
          y: prevY - y,
          z: prevZ - z,
        };
        return;
      }

      prevX = x;
      prevY = y;
      prevZ = z;
    }
  }

  placeBlock() {
    if (!this.targetBlock || !this.targetFace) return false;

    const px = this.targetBlock.x + this.targetFace.x;
    const py = this.targetBlock.y + this.targetFace.y;
    const pz = this.targetBlock.z + this.targetFace.z;

    const halfW = this.width / 2;
    const playerMin = {
      x: this.position.x - halfW, y: this.position.y, z: this.position.z - halfW
    };
    const playerMax = {
      x: this.position.x + halfW, y: this.position.y + this.height, z: this.position.z + halfW
    };

    if (px + 1 > playerMin.x && px < playerMax.x &&
        py + 1 > playerMin.y && py < playerMax.y &&
        pz + 1 > playerMin.z && pz < playerMax.z) {
      return false;
    }

    if (py < 0 || py >= CHUNK_HEIGHT) return false;
    if (this.world.getBlock(px, py, pz) !== BlockType.AIR) return false;

    this.world.setBlock(px, py, pz, this.selectedBlock);
    return true;
  }

  breakBlock() {
    if (!this.targetBlock) return false;

    const { x, y, z } = this.targetBlock;
    if (y < 0 || y >= CHUNK_HEIGHT) return false;

    this.world.setBlock(x, y, z, BlockType.AIR);
    return true;
  }
}

/* ============================================
   高亮方块线框
   ============================================ */
class BlockHighlight {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2, transparent: true, opacity: 0.6 });
    this.mesh = new THREE.LineSegments(edges, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(targetBlock) {
    if (targetBlock) {
      this.mesh.position.set(targetBlock.x + 0.5, targetBlock.y + 0.5, targetBlock.z + 0.5);
      this.mesh.visible = true;
    } else {
      this.mesh.visible = false;
    }
  }
}

/* ============================================
   触摸控制器（移动端专用）
   ============================================ */
class TouchController {
  constructor(player, game) {
    this.player = player;
    this.game = game;
    this.moveX = 0;
    this.moveZ = 0;
    this._joystickId = null;
    this._lookTouchId = null;
    this._lastTouchX = 0;
    this._lastTouchY = 0;
    this._init();
  }

  _init() {
    const zone = document.getElementById('joystickZone');
    const thumb = document.getElementById('joystickThumb');
    const canvas = this.game.canvas;

    this._joystickId = null;
    this._lookTouchId = null;

    const findJoystickTouch = (e) => {
      if (this._joystickId === null) return null;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this._joystickId) return e.touches[i];
      }
      return null;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._joystickId === null) {
        this._joystickId = e.changedTouches[0].identifier;
      }
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('touchcancel', (e) => {
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });

    const findLookTouch = (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          return t;
        }
      }
      return null;
    };

    canvas.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.target && t.target.closest && t.target.closest('#actionButtons, #joystickZone, #mobileHotbar, #settingsPanel, #inventoryScreen, #questPanel')) continue;
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          this._lookTouchId = t.identifier;
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (this._lookTouchId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier === this._lookTouchId) {
          const dx = t.clientX - this._lastTouchX;
          const dy = t.clientY - this._lastTouchY;
          this.player.onMouseMove(dx * 1.8, dy * 1.8);
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });
    canvas.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });

    // 操作按钮
    const btnJump = document.getElementById('btnJump');
    const btnPlace = document.getElementById('btnPlace');
    const btnBreak = document.getElementById('btnBreak');
    const btnAttack = document.getElementById('btnAttack');

    const _flashBtn = (btn, isError) => {
      if (!btn) return;
      const bg = isError ? 'rgba(255, 80, 80, 0.4)' : 'rgba(255, 255, 255, 0.35)';
      const border = isError ? 'rgba(255, 80, 80, 0.7)' : 'rgba(255, 255, 255, 0.6)';
      btn.style.background = bg;
      btn.style.borderColor = border;
      btn.style.transition = 'background 0.1s, border-color 0.1s';
      setTimeout(() => {
        btn.style.background = 'rgba(255, 255, 255, 0.12)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
      }, 150);
    };

    const _haptic = (pattern) => {
      if (navigator.vibrate) navigator.vibrate(pattern);
    };

    if (btnJump) {
      const _jumpDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = true;
        _flashBtn(btnJump);
      };
      const _jumpUp = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = false;
      };
      btnJump.addEventListener('pointerdown', _jumpDown);
      btnJump.addEventListener('pointerup', _jumpUp);
      btnJump.addEventListener('pointercancel', _jumpUp);
      btnJump.addEventListener('pointerleave', _jumpUp);
    }

    if (btnAttack) {
      let _attackHoldTimer = null;
      btnAttack.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 攻击按钮直接射击，开镜用瞄准按钮
        this.game._weaponAttack();
        // 自动武器：长按持续射击
        const wType = this.game.weaponManager.currentWeapon;
        const wDef = WeaponDefs[wType];
        if (wDef && wDef.auto) {
          this.game._isFiring = true;
        }
        _flashBtn(btnAttack);
      });
      btnAttack.addEventListener('pointerup', (e) => {
        e.preventDefault();
        this.game._isFiring = false;
      });
      btnAttack.addEventListener('pointercancel', (e) => {
        this.game._isFiring = false;
      });
      btnAttack.addEventListener('pointerleave', (e) => {
        this.game._isFiring = false;
        _attackHoldTimer = null;
      });
    }

    const btnAim = document.getElementById('btnAim');
    if (btnAim) {
      btnAim.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentItem = this.game.inventory?.getCurrentItem();
        const isGrenade = currentItem && currentItem.weaponType === WeaponType.GRENADE;
        if (isGrenade) {
          // 手榴弹：按住显示抛物线
          this.game._rightMouseDown = true;
        } else if (this.game.isAiming) {
          this.game._toggleScope(false);
          if (this.game.weaponManager && this.game.weaponManager.renderer) {
            this.game.weaponManager.renderer.setScopeActive(false);
          }
        } else {
          this.game._toggleScope();
          if (this.game.scopeLevel > 0 && this.game.weaponManager && this.game.weaponManager.renderer) {
            this.game.weaponManager.renderer.setScopeActive(true);
          }
        }
        _flashBtn(btnAim);
      });
      btnAim.addEventListener('pointerup', (e) => {
        const currentItem = this.game.inventory?.getCurrentItem();
        const isGrenade = currentItem && currentItem.weaponType === WeaponType.GRENADE;
        if (isGrenade && this.game._rightMouseDown) {
          // 松开投掷手榴弹
          this.game._rightMouseDown = false;
          this.game._weaponAttack();
          if (this.game.grenadeTrajectory) this.game.grenadeTrajectory.hide();
        }
      });
      btnAim.addEventListener('pointercancel', () => {
        this.game._rightMouseDown = false;
        if (this.game.grenadeTrajectory) this.game.grenadeTrajectory.hide();
      });
      btnAim.addEventListener('pointerleave', () => {
        this.game._rightMouseDown = false;
        if (this.game.grenadeTrajectory) this.game.grenadeTrajectory.hide();
      });
    }

    const btnFullscreen = document.getElementById('btnFullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.game._toggleFullscreen();
        _flashBtn(btnFullscreen);
      });
    }

    if (btnPlace) {
      btnPlace.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = this.player.placeBlock();
        this.weaponManager.triggerPlace();
        _flashBtn(btnPlace, !ok);
        if (!ok) _haptic(10);
      });
    }

    if (btnBreak) {
      btnBreak.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = this.player.breakBlock();
        _flashBtn(btnBreak, !ok);
        if (!ok) _haptic(10);
      });
    }
  }

  _updateJoystick(touch, zone, thumb) {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 25;

    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxR) {
      dx = dx / dist * maxR;
      dy = dy / dist * maxR;
    }

    this.moveX = dx / maxR;
    this.moveZ = dy / maxR;

    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

/* ============================================
   游戏主类
   ============================================ */
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.isRunning = false;
    this.isPointerLocked = false;

    this.isMobile = isMobileDevice();
    this.renderDistance = getRenderDistance();

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.world = null;
    this.player = null;
    this.highlight = null;
    this.touchController = null;
    this.animalManager = null;

    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTime = 0;
    this.fps = 0;

    this.isAiming = false;
    this.scopeLevel = 0; // 0=off, 1=1.5x, 2=3x
    this._rightMouseDown = false;
    this.baseFOV = 75;
    this._pointerLockExitTime = 0; // 记录上次退出指针锁定的时间

    // Q键快速切换
    this._lastWeaponSlot = -1;

    // 命中标记
    this._hitMarkerTimer = 0;

    // 自动射击标志（长按左键持续射击）
    this._isFiring = false;

    // 设置参数（灵敏度、晃动、平滑度）
    this.mouseSensitivity = 0.002;
    this.bobIntensity = 1.0;
    this.moveSmoothing = 0.85;

    // 波次系统
    this.waveNumber = 0;
    this.waveEnemiesAlive = 0;
    this.waveKills = 0;
    this.totalKills = 0;

    // 任务系统
    this.quests = [];
    this._initQuests();
    this._footstepTimer = 0;

    // 新手引导
    this.tutorialOverlayStep = 0;
    this.tutorialOverlayTimer = 0;
    this.tutorialOverlayShown = false;

    this.ui = {
      crosshair: document.getElementById('crosshair'),
      hotbar: document.getElementById('hotbar'),
      selectedBlockName: document.getElementById('selectedBlockName'),
      debugInfo: document.getElementById('debugInfo'),
      blockHighlight: document.getElementById('blockHighlight'),
      startScreen: document.getElementById('startScreen'),
      pauseScreen: document.getElementById('pauseScreen'),
      loadingBar: document.getElementById('loadingBar'),
      loadingFill: document.getElementById('loadingFill'),
      controlsPanel: document.getElementById('controlsPanel'),
    };

    this.inventory = new Inventory();
    this.inventoryUI = null;
    this.weaponManager = null;

    // HUD 元素引用
    this._healthBarEl = null;
    this._healthFillEl = null;
    this._healthTextEl = null;
    this._reloadBarEl = null;
    this._reloadFillEl = null;
    this._reloadTextEl = null;
    this._ammoEl = null;
    this._hitOverlayEl = null;
    this._deathScreenEl = null;
  }

  /** 初始化游戏 */
  async init() {
    try {
      console.log('[Game] 开始初始化...');

      this._initRenderer();
      this._initScene();
      this._initPlayer();
      this._initHighlight();
      this._initWeaponSystem();
      this._initHUD();
      this._initHotbar();

      if (this.isMobile) {
        this._initMobileHotbar();
      }

      this._initEvents();
      this._initSettingsSliders();
    } catch(e) {
      console.error('[Game] 初始化失败:', e.message, e.stack);
      alert('游戏初始化失败: ' + e.message);
      return;
    }

    // 预览视角
    this.camera.position.set(0, 23, 12);
    this.camera.lookAt(0, 25, 0);

    this.ui.loadingBar.style.display = 'block';

    // 快速启动：只加载半径2的区块（约12个），其余在游戏运行中加载
    const startupRadius = 2;
    const chunksToLoad = [];
    for (let dx = -startupRadius; dx <= startupRadius; dx++) {
      for (let dz = -startupRadius; dz <= startupRadius; dz++) {
        if (dx * dx + dz * dz > startupRadius * startupRadius) continue;
        chunksToLoad.push([dx, dz]);
      }
    }
    chunksToLoad.sort((a, b) => {
      const dA = a[0] * a[0] + a[1] * a[1];
      const dB = b[0] * b[0] + b[1] * b[1];
      return dA - dB;
    });

    const needed = chunksToLoad.length;
    let generated = 0;

    for (const [cx, cz] of chunksToLoad) {
      const key = this.world.chunkKey(cx, cz);
      if (!this.world.chunks.has(key)) {
        const chunk = await this._createChunk(cx, cz);
        if (chunk.mesh) this.scene.add(chunk.mesh);
        if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
        generated++;
        this.ui.loadingFill.style.width = `${(generated / needed * 100) | 0}%`;
        if (generated % 2 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    this._spawnX = 5.4;
    this._spawnZ = 22.6;
    this._spawnY = 25;
    this.player.position.set(this._spawnX, this._spawnY, this._spawnZ);
    this.player.yaw = 0;
    this.player.pitch = -0.3;

    this.ui.loadingBar.style.display = 'none';

    this.animalManager.spawnAnimals();
    this.animalManager.setPlayer(this.player);

    // 延迟1秒后生成文字立墙（避免启动时卡顿）
    this._textLoaded = false;
    setTimeout(() => {
      if (this.world && !this._textLoaded) {
        this.world.enableText();
        this._textLoaded = true;
      }
    }, 1000);
  }

  _createChunk(cx, cz) {
    const key = this.world.chunkKey(cx, cz);
    if (this.world.chunks.has(key)) return this.world.chunks.get(key);

    const chunk = new Chunk(cx, cz);
    this.world.generateChunkData(chunk);
    chunk.buildMesh((wx, wy, wz) => this.world.getBlock(wx, wy, wz), this.world.material, this.world.waterMaterial);
    this.world.chunks.set(key, chunk);
    return chunk;
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: this.isMobile ? 'low-power' : 'default',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const maxPixelRatio = this.isMobile ? 1.2 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setClearColor(0x87CEEB);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene._particles = [];
    this.scene._enemyBullets = [];

    const fogFar = this.renderDistance * CHUNK_SIZE + 4;
    const fogNear = this.isMobile ? Math.max(25, fogFar - 20) : Math.max(15, fogFar - 40);
    this.scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(50, 100, 30);
    this.scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.3);
    this.scene.add(hemiLight);

    this.world = new World(this.scene);
    this.world.renderDistance = this.renderDistance;
    this.world.init();

    this.animalManager = new AnimalManager(this.scene, this.world, this.isMobile);

    this.defaultFov = this.isMobile ? 90 : 75;
    this.fov = this.defaultFov;
    this.fovMin = 15;
    this.fovMax = 130;
    this.camera = new THREE.PerspectiveCamera(
      this.fov, window.innerWidth / window.innerHeight, 0.1, 1000
    );
    this.scene.add(this.camera);

    // 保存相机引用到场景，供怪物血条面向相机使用
    this.scene.userData.camera = this.camera;
  }

  _initPlayer() {
    this.player = new Player(this.camera, this.world);

    // 玩家HP变化回调
    this.player.onHPChanged = (hp, maxHP) => {
      this._updateHealthBar(hp, maxHP);
    };

    // 玩家死亡回调
    this.player.onDeath = () => {
      this._showDeathScreen();
    };
  }

  _initWeaponSystem() {
    this.weaponManager = new WeaponManager(this.scene, this.camera, this.world, this.animalManager);
    this.inventoryUI = new InventoryUI(this.inventory);
    this.grenadeTrajectory = new GrenadeTrajectory(this.scene);

    // 换弹进度回调
    this.weaponManager.onReloadProgress = (progress) => {
      this._updateReloadBar(progress);
    };
    this.weaponManager.onReloadComplete = () => {
      this._hideReloadBar();
    };
    this.weaponManager.onAmmoChanged = () => {
      this._updateAmmoHUD();
    };

    // 命中/击杀回调
    this.weaponManager.onEnemyHit = (animal) => {
      this._showHitMarker();
    };
    this.weaponManager.onEnemyKill = (animal) => {
      const name = animal.robotType === 'heavy' ? '重型机器人' : '侦察机器人';
      this._showKillFeed(name);
      this.waveKills++;
      this.totalKills++;
      this._updateWaveInfo();

      // 更新任务进度
      for (const q of this.quests) {
        if (q.done) continue;
        if (q.type === 'kill_total') { q.progress++; if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); } }
        if (q.type === 'kill_scout' && animal.robotType === 'scout') { q.progress++; if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); } }
        if (q.type === 'kill_heavy' && animal.robotType === 'heavy') { q.progress++; if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); } }
      }
    };

    // 射击后坐力（相机抖动 + 玩家物理后退）
    this.weaponManager.onShootRecoil = (recoilAmount) => {
      this.player.pitch += recoilAmount * 0.3;
      this.player.yaw += (Math.random() - 0.5) * recoilAmount * 0.15;

      // 物理后坐力：推动玩家后退（通过knockbackVel，走碰撞检测防穿墙）
      const wType = this.weaponManager.currentWeapon;
      const wDef = WeaponDefs[wType];
      if (wDef && wDef.pushback) {
        const backDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
        this.player.knockbackVel.x += backDir.x * wDef.pushback * 3;
        this.player.knockbackVel.z += backDir.z * wDef.pushback * 3;
        this.player.knockbackVel.y += wDef.pushback * 0.8; // 轻微上仰
      }
    };

    // 手榴弹爆炸回调
    this.weaponManager.onBlockExplode = (center, radius, damage) => {
      // 破坏爆炸范围内的方块
      const r = Math.ceil(radius);
      for (let x = -r; x <= r; x++) {
        for (let y = -r; y <= r; y++) {
          for (let z = -r; z <= r; z++) {
            const bx = Math.floor(center.x) + x;
            const by = Math.floor(center.y) + y;
            const bz = Math.floor(center.z) + z;
            const dist = Math.sqrt(x * x + y * y + z * z);
            if (dist <= radius) {
              const block = this.world.getBlock(bx, by, bz);
              if (block && block !== BlockType.AIR && block !== BlockType.WATER) {
                this.world.setBlock(bx, by, bz, BlockType.AIR);
              }
            }
          }
        }
      }
    };

    this.weaponManager.onPlayerHurt = (damage, fromPos) => {
      this.player.takeDamage(damage, fromPos, true);
    };

    this.weaponManager.onGrenadeExplode = () => {
      audio.explosion();
    };

    // 手榴弹范围伤害回调
    this.weaponManager.onAreaDamage = (center, damage, radius) => {
      if (!this.animalManager) return;
      for (const robot of this.animalManager.robots) {
        if (!robot.alive) continue;
        const pos = robot.group ? robot.group.position : robot.position;
        const dist = center.distanceTo(pos);
        if (dist <= radius) {
          const dmg = Math.round(damage * (1 - dist / radius));
          if (dmg > 0) {
            robot.takeDamage(dmg, { position: center }, true, true);
            this._showHitMarker();
          }
        }
      }
    };
  }

  _initHighlight() {
    this.highlight = new BlockHighlight(this.scene);
  }

  /** 初始化HUD元素 */
  _initHUD() {
    // === 玩家血条 ===
    const healthBar = document.getElementById('healthBar');
    if (healthBar) {
      this._healthBarEl = healthBar;
      this._healthFillEl = document.getElementById('healthFill');
      this._healthTextEl = document.getElementById('healthText');
    } else {
      // 创建血条
      const hb = document.createElement('div');
      hb.id = 'healthBar';
      hb.innerHTML = `
        <div class="health-icon">❤</div>
        <div class="health-track"><div class="health-fill" id="healthFill"></div></div>
        <div class="health-text" id="healthText">100</div>
      `;
      document.body.appendChild(hb);
      this._healthBarEl = hb;
      this._healthFillEl = document.getElementById('healthFill');
      this._healthTextEl = document.getElementById('healthText');
    }

    // === 换弹进度条 ===
    const reloadBar = document.getElementById('reloadBar');
    if (reloadBar) {
      this._reloadBarEl = reloadBar;
      this._reloadFillEl = document.getElementById('reloadFill');
      this._reloadTextEl = document.getElementById('reloadText');
    } else {
      const rb = document.createElement('div');
      rb.id = 'reloadBar';
      rb.style.display = 'none';
      rb.innerHTML = `
        <div class="reload-label">换弹中</div>
        <div class="reload-track"><div class="reload-fill" id="reloadFill"></div></div>
      `;
      document.body.appendChild(rb);
      this._reloadBarEl = rb;
      this._reloadFillEl = document.getElementById('reloadFill');
      this._reloadTextEl = rb.querySelector('.reload-label');
    }

    // === 弹药HUD ===
    const ammoHUD = document.getElementById('ammoHUD');
    if (ammoHUD) {
      this._ammoEl = ammoHUD;
    } else {
      const ah = document.createElement('div');
      ah.id = 'ammoHUD';
      ah.style.display = 'none';
      document.body.appendChild(ah);
      this._ammoEl = ah;
    }

    // === 受击红色叠加 ===
    const hitOverlay = document.getElementById('hitOverlay');
    if (hitOverlay) {
      this._hitOverlayEl = hitOverlay;
    } else {
      const ho = document.createElement('div');
      ho.id = 'hitOverlay';
      document.body.appendChild(ho);
      this._hitOverlayEl = ho;
    }

    // === 死亡界面 ===
    const deathScreen = document.getElementById('deathScreen');
    if (deathScreen) {
      this._deathScreenEl = deathScreen;
    } else {
      const ds = document.createElement('div');
      ds.id = 'deathScreen';
      ds.style.display = 'none';
      ds.innerHTML = `
        <div class="death-title">你已阵亡</div>
        <div class="death-hint">点击重生</div>
      `;
      document.body.appendChild(ds);
      this._deathScreenEl = ds;

      this._deathScreenEl.addEventListener('click', () => {
        this._respawnPlayer();
      });
    }

    this._updateHealthBar(this.player.hp, this.player.maxHP);

    // === 命中标记 ===
    const hitMarker = document.getElementById('hitMarker');
    if (!hitMarker) {
      const hm = document.createElement('div');
      hm.id = 'hitMarker';
      hm.innerHTML = '<span></span><span></span><span></span><span></span>';
      document.body.appendChild(hm);
    }

    // === 伤害方向指示 ===
    const damageDir = document.getElementById('damageDir');
    if (!damageDir) {
      const di = document.createElement('div');
      di.id = 'damageDir';
      document.body.appendChild(di);
    }

    // === 击杀提示 ===
    const killFeed = document.getElementById('killFeed');
    if (!killFeed) {
      const kf = document.createElement('div');
      kf.id = 'killFeed';
      document.body.appendChild(kf);
    }

    // === 波次信息 ===
    const waveInfo = document.getElementById('waveInfo');
    if (!waveInfo) {
      const wi = document.createElement('div');
      wi.id = 'waveInfo';
      document.body.appendChild(wi);
    }

    // === 新手引导 ===
    const tutorialOverlay = document.getElementById('tutorialOverlay');
    if (!tutorialOverlay) {
      const t = document.createElement('div');
      t.id = 'tutorialOverlay';
      document.body.appendChild(t);
    }
  }

  /** 更新血条 */
  _updateHealthBar(hp, maxHP) {
    if (!this._healthFillEl) return;
    const ratio = Math.max(0, hp / maxHP);
    this._healthFillEl.style.width = `${ratio * 100}%`;

    if (ratio > 0.6) {
      this._healthFillEl.style.background = '#4CAF50';
    } else if (ratio > 0.3) {
      this._healthFillEl.style.background = '#FF9800';
    } else {
      this._healthFillEl.style.background = '#F44336';
    }

    if (this._healthTextEl) {
      this._healthTextEl.textContent = Math.ceil(hp);
    }
  }

  /** 更新换弹进度条 */
  _updateReloadBar(progress) {
    if (!this._reloadBarEl) return;
    this._reloadBarEl.style.display = 'flex';
    if (this._reloadFillEl) {
      this._reloadFillEl.style.width = `${progress * 100}%`;
    }
  }

  /** 隐藏换弹进度条 */
  _hideReloadBar() {
    if (!this._reloadBarEl) return;
    this._reloadBarEl.style.display = 'none';
  }

  /** 更新弹药HUD */
  _updateAmmoHUD() {
    if (!this._ammoEl) return;

    const currentItem = this.inventory.getCurrentItem();
    if (!currentItem || currentItem.type !== 'weapon') {
      this._ammoEl.style.display = 'none';
      return;
    }

    const wDef = WeaponDefs[currentItem.weaponType];
    if (!wDef || wDef.type !== 'ranged') {
      this._ammoEl.style.display = 'none';
      return;
    }

    const ammoInfo = this.weaponManager.getAmmoInfo(currentItem.weaponType);
    if (!ammoInfo) {
      this._ammoEl.style.display = 'none';
      return;
    }

    const totalAmmo = this.inventory.getAmmoCount(wDef.ammoType);
    this._ammoEl.style.display = 'block';
    this._ammoEl.innerHTML = `
      <span class="ammo-mag">${ammoInfo.current}</span>
      <span class="ammo-sep">/</span>
      <span class="ammo-max">${ammoInfo.max}</span>
      <span class="ammo-reserve"> | ${totalAmmo}</span>
    `;
  }

  /** 受击红色叠加 - 带方向指示 */
  _showHitOverlay(fromPosition) {
    if (!this._hitOverlayEl) return;
    this._hitOverlayEl.style.opacity = '0.4';
    setTimeout(() => {
      this._hitOverlayEl.style.opacity = '0';
    }, 200);

    // 受击音效
    audio.hurt();

    // 伤害方向指示
    if (fromPosition) {
      this._showDmgIndicator(fromPosition);
    }
  }

  /** 显示伤害方向指示 */
  _showDmgIndicator(fromPos) {
    const di = document.getElementById('damageDir');
    if (!di) return;

    // 计算伤害来源方向相对于玩家视角的角度
    const dx = fromPos.x - this.player.position.x;
    const dz = fromPos.z - this.player.position.z;
    const angle = Math.atan2(dx, -dz) - this.player.yaw;

    // 创建方向箭头
    const arrow = document.createElement('div');
    arrow.className = 'dmg-arrow';
    arrow.style.transform = `rotate(${angle}rad)`;

    di.appendChild(arrow);
    setTimeout(() => {
      if (arrow.parentNode) arrow.parentNode.removeChild(arrow);
    }, 800);
  }

  /** 显示命中标记 - 准心变红 */
  _showHitMarker() {
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.classList.add('hit');
      this._hitMarkerTimer = 0.2;
    }
    // 音效
    audio.hit();
    // 更新命中任务
    for (const q of this.quests) {
      if (q.done) continue;
      if (q.type === 'hit_enemy') { q.progress++; if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); } }
    }
  }

  /** 切换狙击枪倍镜 */
  _toggleScope(on) {
    if (!this.weaponManager) return;
    const def = WeaponDefs[this.weaponManager.currentWeapon];
    if (!def || def.type !== 'ranged') return;
    if (on) {
      if (def.ammoType === 'sniper') {
        // 狙击枪三段倍镜：0→1.5x→3x→off
        if (this.scopeLevel === 0) {
          this.scopeLevel = 1; // 1.5x
          this.isAiming = true;
          this.targetFov = this.fov / 1.5;
          this._showScopeOverlay(true);
        } else if (this.scopeLevel === 1) {
          this.scopeLevel = 2; // 3x
          this.isAiming = true;
          this.targetFov = this.fov / 3;
          this._showScopeOverlay(true);
        } else {
          // 3x → off
          this.scopeLevel = 0;
          this.isAiming = false;
          this.targetFov = this.fov;
          this._showScopeOverlay(false);
        }
      } else {
        // 其他远程武器普通瞄准
        this.isAiming = true;
        this.scopeLevel = 0;
        this.targetFov = this.fov * 0.67;
      }
    } else {
      this.scopeLevel = 0;
      this.isAiming = false;
      this.targetFov = this.fov;
      this._showScopeOverlay(false);
    }
  }

  /** 切换全屏 */
  _toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  /** 狙击枪倍镜覆盖层 */
  _showScopeOverlay(show) {
    let overlay = document.getElementById('scopeOverlay');
    if (show) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'scopeOverlay';
        overlay.style.cssText = `
          position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;pointer-events:none;
          background:radial-gradient(circle at center,transparent 28%,rgba(0,0,0,0.95) 34%);
        `;
        // 十字线
        const cross = document.createElement('div');
        cross.style.cssText = `
          position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
          width:60%;height:60%;pointer-events:none;
        `;
        // 水平线
        const hLine = document.createElement('div');
        hLine.style.cssText = `position:absolute;top:50%;left:0;width:100%;height:1px;background:rgba(0,0,0,0.6);`;
        // 垂直线
        const vLine = document.createElement('div');
        vLine.style.cssText = `position:absolute;left:50%;top:0;height:100%;width:1px;background:rgba(0,0,0,0.6);`;
        // 中心点
        const dot = document.createElement('div');
        dot.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:4px;background:red;border-radius:50%;`;
        cross.appendChild(hLine);
        cross.appendChild(vLine);
        cross.appendChild(dot);
        overlay.appendChild(cross);
        // 倍率显示
        const zoom = document.createElement('div');
        zoom.id = 'scopeZoom';
        zoom.style.cssText = `position:absolute;bottom:15%;left:50%;transform:translateX(-50%);color:#0f0;font-size:24px;font-weight:bold;text-shadow:0 0 4px #000;`;
        overlay.appendChild(zoom);
        document.body.appendChild(overlay);
      } else {
        overlay.style.display = 'block';
      }
      // 更新倍率文字
      const zoomEl = document.getElementById('scopeZoom');
      if (zoomEl) {
        const fov = this.scopeLevel === 2 ? 18 : 35;
        const mag = Math.round(75 / fov * 10) / 10;
        zoomEl.textContent = mag + 'x';
      }
      // 隐藏武器模型
      if (this.weaponManager && this.weaponManager.renderer && this.weaponManager.renderer.weaponGroup) {
        this.weaponManager.renderer.weaponGroup.visible = false;
      }
    } else {
      if (overlay) overlay.style.display = 'none';
      // 显示武器模型
      if (this.weaponManager && this.weaponManager.renderer && this.weaponManager.renderer.weaponGroup) {
        this.weaponManager.renderer.weaponGroup.visible = true;
      }
    }
  }

  /** 显示击杀提示 */
  _showKillFeed(enemyName) {
    const kf = document.getElementById('killFeed');
    if (!kf) return;

    const msg = document.createElement('div');
    msg.className = 'kill-msg';
    msg.innerHTML = `<span class="kill-icon">☠</span> 击杀 <span class="kill-name">${enemyName}</span>`;
    kf.appendChild(msg);

    setTimeout(() => {
      msg.classList.add('fade-out');
      setTimeout(() => {
        if (msg.parentNode) msg.parentNode.removeChild(msg);
      }, 500);
    }, 2000);
  }

  /** 更新波次信息 */
  _updateWaveInfo() {
    const wi = document.getElementById('waveInfo');
    if (!wi) return;
    wi.innerHTML = `<span class="wave-num">第 ${this.waveNumber} 波</span>` +
      `<span class="wave-kills">击杀: ${this.waveKills}</span>`;
  }

  /** 开始新一波 */
  _startWave() {
    this.waveNumber++;
    this.waveKills = 0;

    // 根据波次增加敌人数量
    const baseScout = this.isMobile ? 2 : 5;
    const baseHeavy = this.isMobile ? 1 : 3;
    const extraScouts = Math.min(this.waveNumber - 1, 4);
    const extraHeavies = Math.min(Math.floor((this.waveNumber - 1) / 2), 3);

    this._showHint(`第 ${this.waveNumber} 波来袭！`);

    this.waveEnemiesAlive = baseScout + extraScouts + baseHeavy + extraHeavies;
    this._updateWaveInfo();
  }

  /** 新手引导 */
  _updateTutorial(dt) {
    if (this.tutorialOverlayShown) return;

    const tutorialOverlay = document.getElementById('tutorialOverlay');
    if (!tutorialOverlay) return;

    this.tutorialOverlayTimer += dt;

    // 缩短教程时间，5秒内全部显示完毕
    const steps = [
      { time: 0.5, text: 'WASD 移动 | 鼠标控制视角' },
      { time: 1.5, text: '左键攻击 | 右键瞄准/破坏方块' },
      { time: 2.5, text: '滚轮/数字键 切换武器 | Q 快速切换' },
      { time: 3.5, text: 'R 换弹 | E/B 打开背包' },
      { time: 4.5, text: '消灭机器人，生存下去！' },
    ];

    const currentStep = steps.findIndex((s, i) => {
      const next = steps[i + 1];
      return this.tutorialOverlayTimer >= s.time && (!next || this.tutorialOverlayTimer < next.time);
    });

    if (currentStep >= 0 && currentStep !== this.tutorialOverlayStep) {
      this.tutorialOverlayStep = currentStep;
      tutorialOverlay.innerHTML = `<div class="tutorial-text">${steps[currentStep].text}</div>`;
      tutorialOverlay.style.opacity = '1';
      tutorialOverlay.style.display = 'block';
    }

    // 6秒后隐藏教程
    if (this.tutorialOverlayTimer > 6) {
      this._hideTutorial(tutorialOverlay);
    }
  }

  /** 隐藏教程 */
  _hideTutorial(overlay) {
    if (this.tutorialOverlayShown) return;
    this.tutorialOverlayShown = true;
    const el = overlay || document.getElementById('tutorialOverlay');
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 300);
    }
  }

  /** 初始化任务 */
  _initQuests() {
    this.quests = [
      { id: 'kill_scout', name: '初试锋芒', desc: '击杀 3 个侦察机器人', target: 3, progress: 0, type: 'kill_scout', reward: '解锁近战武器', done: false },
      { id: 'kill_heavy', name: '重装猎手', desc: '击杀 2 个重型机器人', target: 2, progress: 0, type: 'kill_heavy', reward: '解锁霰弹枪', done: false },
      { id: 'kill_total', name: '战场老兵', desc: '累计击杀 10 个敌人', target: 10, progress: 0, type: 'kill_total', reward: '弹药补给', done: false },
      { id: 'survive', name: '幸存者', desc: '存活 3 分钟不死亡', target: 180, progress: 0, type: 'survive', reward: '生命值恢复', done: false },
      { id: 'headshot', name: '精准射手', desc: '命中敌人 20 次', target: 20, progress: 0, type: 'hit_enemy', reward: '伤害提升', done: false },
      { id: 'explore', name: '探索者', desc: '移动距离超过 200 格', target: 200, progress: 0, type: 'distance', reward: '移动速度提升', done: false },
    ];
    this._surviveTimer = 0;
    this._distanceTraveled = 0;
    this._lastPlayerPos = null;
  }

  /** 更新任务进度 */
  _updateQuests(dt) {
    // 存活任务
    if (!this.player.dead) {
      this._surviveTimer += dt;
    } else {
      this._surviveTimer = 0;
    }

    // 移动距离任务
    if (this._lastPlayerPos && !this.player.dead) {
      const dx = this.player.position.x - this._lastPlayerPos.x;
      const dz = this.player.position.z - this._lastPlayerPos.z;
      this._distanceTraveled += Math.sqrt(dx * dx + dz * dz);
    }
    this._lastPlayerPos = this.player.position.clone();

    // 更新任务进度
    for (const q of this.quests) {
      if (q.done) continue;
      switch (q.type) {
        case 'kill_scout':
        case 'kill_heavy':
        case 'kill_total':
          // 这些在 _onEnemyKill 中更新
          break;
        case 'survive':
          q.progress = Math.floor(this._surviveTimer);
          if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); }
          break;
        case 'hit_enemy':
          // 在 showHitMarker 中更新
          break;
        case 'distance':
          q.progress = Math.floor(this._distanceTraveled);
          if (q.progress >= q.target) { q.done = true; this._onQuestComplete(q); }
          break;
      }
    }
    this._renderQuests();
  }

  /** 任务完成回调 */
  _onQuestComplete(quest) {
    if (audio) audio.quest();
    this._showKillFeed(`✦ 任务完成: ${quest.name}`, '#ffd700');

    // 任务奖励
    switch (quest.id) {
      case 'kill_scout':
        // 解锁战斧
        this.inventory.addItem({ type: 'weapon', weaponType: 3 }); // AXE
        break;
      case 'kill_heavy':
        // 解锁霰弹枪
        this.inventory.addItem({ type: 'weapon', weaponType: 6 }); // SHOTGUN
        break;
      case 'kill_total':
        // 弹药补给
        this.inventory.addAmmo(30, 60, 12, 60, 10);
        break;
      case 'survive':
        // 恢复生命值
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 50);
        break;
      case 'headshot':
        // 伤害提升在 WeaponManager 中处理
        this.player.damageBonus = (this.player.damageBonus || 0) + 2;
        break;
      case 'explore':
        // 速度提升
        this.player.speedBoost = (this.player.speedBoost || 0) + 1;
        break;
    }
  }

  /** 渲染任务面板 */
  _renderQuests() {
    const questPanel = document.getElementById('questPanel');
    if (!questPanel) return;

    const activeQuests = this.quests.filter(q => !q.done);
    if (activeQuests.length === 0) {
      questPanel.innerHTML = '<div style="color:#ffd700;font-size:12px;padding:4px 8px;">✦ 全部任务完成！</div>';
      return;
    }

    questPanel.innerHTML = activeQuests.map(q => {
      const pct = Math.min(100, Math.floor(q.progress / q.target * 100));
      const barColor = pct >= 100 ? '#4ade80' : '#60a5fa';
      return `<div class="quest-item">
        <div class="quest-name">${q.name}</div>
        <div class="quest-desc">${q.desc}</div>
        <div class="quest-bar"><div class="quest-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="quest-progress">${q.progress}/${q.target}</div>
      </div>`;
    }).join('');
  }

  /** 显示死亡界面 */
  _showDeathScreen() {
    if (this._deathScreenEl) {
      this._deathScreenEl.style.display = 'flex';
    }
    if (!this.isMobile) {
      try { document.exitPointerLock(); } catch(_) {}
    }
  }

  /** 重生 */
  _respawnPlayer() {
    this.player.respawn(new THREE.Vector3(this._spawnX, this._spawnY, this._spawnZ));
    if (this._deathScreenEl) {
      this._deathScreenEl.style.display = 'none';
    }
    if (!this.isMobile) {
      try { this.canvas.requestPointerLock(); } catch(_) {}
    }
  }

  _initHotbar() {
    const hotbar = this.ui.hotbar;
    hotbar.innerHTML = '';

    for (let i = 0; i < this.inventory.cols; i++) {
      const item = this.inventory.getHotbarItem(i);
      const slot = document.createElement('div');
      slot.className = `hotbar-slot${i === this.inventory.selectedSlot ? ' selected' : ''}`;
      slot.dataset.index = i;

      const preview = document.createElement('div');
      preview.className = 'block-preview';

      if (item) {
        if (item.type === 'block') {
          preview.style.background = getBlockColor(item.blockType);
          preview.style.boxShadow = 'inset -3px -3px 0 rgba(0,0,0,0.25), inset 3px 3px 0 rgba(255,255,255,0.15)';
        } else if (item.type === 'weapon') {
          const wDef = WeaponDefs[item.weaponType];
          const wColor = wDef ? (wDef.color || wDef.bulletColor || wDef.bodyColor || 0x888888) : 0x888888;
          preview.style.background = `#${wColor.toString(16).padStart(6, '0')}`;
          preview.style.boxShadow = `0 0 6px ${preview.style.background}`;
          preview.classList.add('weapon-preview');
          if (wDef) {
            const nameEl = document.createElement('span');
            nameEl.className = 'weapon-name-label';
            nameEl.textContent = wDef.name;
            slot.appendChild(nameEl);
          }
        } else if (item.type === 'ammo') {
          const ammoColors = { pistol: '#FFEB3B', rifle: '#00E5FF', shotgun: '#FF6D00', smg: '#76FF03', sniper: '#E040FB' };
          preview.style.background = ammoColors[item.ammoType] || '#888';
          preview.style.boxShadow = `0 0 4px ${preview.style.background}`;
          preview.classList.add('ammo-preview');
        }

        if (item.count > 1) {
          const countEl = document.createElement('span');
          countEl.className = 'slot-count';
          countEl.textContent = item.count;
          slot.appendChild(countEl);
        }
      }

      slot.appendChild(preview);

      const keyLabel = document.createElement('span');
      keyLabel.className = 'slot-key';
      keyLabel.textContent = i + 1;
      slot.appendChild(keyLabel);

      hotbar.appendChild(slot);
    }
  }

  _updateHotbar() {
    const slots = this.ui.hotbar.querySelectorAll('.hotbar-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.inventory.selectedSlot);
    });

    const currentItem = this.inventory.getCurrentItem();
    if (currentItem && currentItem.type === 'block') {
      this.player.selectedBlock = currentItem.blockType;
    }

    if (this.weaponManager) {
      const weaponType = this.inventory.getCurrentWeaponType();
      this.weaponManager.switchWeapon(weaponType);
      // 切换武器时关闭瞄准
      if (this.isAiming) {
        this._toggleScope(false);
        this.weaponManager.renderer.setScopeActive(false);
      }
    }

    const nameEl = this.ui.selectedBlockName;
    if (nameEl && currentItem) {
      let name = '';
      if (currentItem.type === 'block') {
        name = BlockNames[currentItem.blockType] || '';
      } else if (currentItem.type === 'weapon') {
        name = WeaponDefs[currentItem.weaponType]?.name || '';
      } else if (currentItem.type === 'ammo') {
        const names = { pistol: '手枪弹药', rifle: '步枪弹药', shotgun: '霰弹' };
        name = names[currentItem.ammoType] || '弹药';
      }
      nameEl.textContent = name;
      nameEl.style.transform = 'translateX(-50%) scale(1.15)';
      nameEl.style.opacity = '1';
      setTimeout(() => {
        nameEl.style.transform = 'translateX(-50%) scale(1)';
      }, 120);
    } else if (nameEl) {
      nameEl.textContent = '';
    }

    if (this.isMobile) this._updateMobileHotbar();
    this._updateAmmoHUD();
  }

  _initMobileHotbar() {
    const mobileHotbar = document.getElementById('mobileHotbar');
    if (!mobileHotbar) return;
    mobileHotbar.innerHTML = '';

    for (let i = 0; i < this.inventory.cols; i++) {
      const item = this.inventory.getHotbarItem(i);
      const slot = document.createElement('div');
      slot.className = `m-slot${i === this.inventory.selectedSlot ? ' selected' : ''}`;
      slot.dataset.index = i;

      const preview = document.createElement('div');
      preview.className = 'm-block-preview';

      if (item) {
        if (item.type === 'block') {
          preview.style.background = getBlockColor(item.blockType);
          preview.style.boxShadow = 'inset -2px -2px 0 rgba(0,0,0,0.25), inset 2px 2px 0 rgba(255,255,255,0.15)';
        } else if (item.type === 'weapon') {
          const wDef = WeaponDefs[item.weaponType];
          const wColor = wDef ? (wDef.color || wDef.bulletColor || wDef.bodyColor || 0x888888) : 0x888888;
          preview.style.background = `#${wColor.toString(16).padStart(6, '0')}`;
          preview.style.boxShadow = `0 0 4px ${preview.style.background}`;
        } else if (item.type === 'ammo') {
          const ammoColors = { pistol: '#FFEB3B', rifle: '#00E5FF', shotgun: '#FF6D00' };
          preview.style.background = ammoColors[item.ammoType] || '#888';
          preview.style.boxShadow = `0 0 3px ${preview.style.background}`;
        }

        if (item.count > 1) {
          const countEl = document.createElement('span');
          countEl.className = 'm-slot-count';
          countEl.textContent = item.count;
          slot.appendChild(countEl);
        }
      }

      slot.appendChild(preview);

      slot.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.inventory.selectedSlot = i;
        this._updateHotbar();
      });

      mobileHotbar.appendChild(slot);
    }
  }

  _updateMobileHotbar() {
    const slots = document.querySelectorAll('#mobileHotbar .m-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.inventory.selectedSlot);
    });
  }

  /** 绑定事件监听 */
  _initEvents() {
    document.addEventListener('keydown', (e) => {
      // 按任意键跳过教程
      if (!this.tutorialOverlayShown && this.isRunning) {
        this._hideTutorial();
      }

      if (this.isInventoryOpen) {
        if (e.code === 'KeyE' || e.code === 'KeyB' || e.code === 'Escape') {
          this.inventoryUI.close();
          this.isInventoryOpen = false;
          // 不自动requestPointerLock，用户点击画面时会自动锁定
          // 延迟恢复避免pauseScreen闪现
          this._inventoryJustClosed = true;
          setTimeout(() => { this._inventoryJustClosed = false; }, 500);
        }
        return;
      }

      this.player.keys[e.code] = true;

      if (e.code >= 'Digit1' && e.code <= 'Digit9') {
        const idx = parseInt(e.code.charAt(5)) - 1;
        if (idx < this.inventory.cols) {
          if (this.inventory.selectedSlot !== idx) {
            this._lastWeaponSlot = this.inventory.selectedSlot;
          }
          this.inventory.selectedSlot = idx;
          this._updateHotbar();
        }
      }

      if ((e.code === 'KeyE' || e.code === 'KeyB') && this.isRunning && !this.isMobile) {
        this.isInventoryOpen = true;
        this._inventoryJustClosed = false;
        try { document.exitPointerLock(); } catch(_) {}
        this.inventoryUI.open();
        return;
      }

      if (e.code === 'Escape' && this.isRunning) {
        if (this.isMobile) {
          this.isRunning = false;
          this.ui.pauseScreen.style.display = 'flex';
          this._showGameUI(false);
        }
      }

      if (e.code === 'Equal') {
        this._adjustFOV(-5);
      }
      if (e.code === 'Minus') {
        this._adjustFOV(5);
      }
      if (e.code === 'Digit0' || e.code === 'Numpad0') {
        this._resetFOV();
      }

      if (e.code === 'KeyR' && this.isRunning) {
        this._reloadWeapon();
      }

      // Q键快速切换武器
      if (e.code === 'KeyQ' && this.isRunning) {
        this._quickSwapWeapon();
      }

      // F11全屏
      if (e.code === 'F11' && this.isRunning) {
        e.preventDefault();
        this._toggleFullscreen();
      }

      // Tab键打开设置
      if (e.code === 'Tab' && this.isRunning) {
        e.preventDefault();
        this._toggleSettings();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.player.keys[e.code] = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;
      this.player.onMouseMove(e.movementX * this.mouseSensitivity / 0.0015, e.movementY * this.mouseSensitivity / 0.0015);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.isPointerLocked) return;

      const currentItem = this.inventory.getCurrentItem();

      if (e.button === 0) {
        if (currentItem && currentItem.type === 'weapon') {
          this._weaponAttack();
          this._isFiring = true;
        } else {
          this.player.placeBlock();
          this.weaponManager.triggerPlace();
        }
      } else if (e.button === 2) {
        this._rightMouseDown = true;
        if (currentItem && currentItem.type === 'weapon') {
          const wDef = WeaponDefs[currentItem.weaponType];
          if (currentItem.weaponType === WeaponType.SNIPER) {
            // 仅狙击枪：右键切换瞄准（循环：off→1.5x→3x→off）
            this._toggleScope(true);
            try { this.weaponManager.renderer.setScopeActive(this.isAiming); } catch(e) {}
          } else if (currentItem.weaponType !== WeaponType.GRENADE) {
            // 普通远程武器右键：破坏方块
            this.player.breakBlock();
          }
          // 手榴弹：右键按住显示抛物线，松开投掷
        } else {
          this.player.breakBlock();
        }
      }
    });

    // 鼠标释放：停止自动射击 / 投掷手榴弹
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._isFiring = false;
      } else if (e.button === 2) {
        this._rightMouseDown = false;
        // 右键松开：如果手持手榴弹则投掷
        if (this.isPointerLocked) {
          const currentItem = this.inventory.getCurrentItem();
          if (currentItem && currentItem.type === 'weapon' && currentItem.weaponType === WeaponType.GRENADE) {
            this._weaponAttack();
          }
        }
        // 隐藏抛物线
        if (this.grenadeTrajectory) this.grenadeTrajectory.hide();
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked) return;

      if (e.ctrlKey) {
        this._adjustFOV(e.deltaY > 0 ? 5 : -5);
        return;
      }

      if (e.deltaY > 0) {
        this._lastWeaponSlot = this.inventory.selectedSlot;
        this.inventory.selectedSlot = (this.inventory.selectedSlot + 1) % this.inventory.cols;
      } else {
        this._lastWeaponSlot = this.inventory.selectedSlot;
        this.inventory.selectedSlot = (this.inventory.selectedSlot - 1 + this.inventory.cols) % this.inventory.cols;
      }
      this._updateHotbar();
    });

    if (!this.isMobile) {
      document.addEventListener('pointerlockchange', () => {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        if (this.isPointerLocked) {
          this.ui.pauseScreen.style.display = 'none';
          this.isInventoryOpen = false;
          if (this.inventoryUI) this.inventoryUI.close();
          this._showGameUI(true);
        } else if (this.isRunning && !this.isInventoryOpen && !this._inventoryJustClosed) {
          this._pointerLockExitTime = performance.now();
          this.ui.pauseScreen.style.display = 'flex';
          // 失去指针锁定时关闭瞄准镜
          if (this.targetFov !== this.fov) {
            this.targetFov = this.fov;
            if (this.weaponManager && this.weaponManager.renderer) {
              this.weaponManager.renderer.scopeActive = false;
            }
            this._showScopeOverlay(false);
            this.isAiming = false;
          }
        }
      });

      const requestLock = () => {
        if (!this.isPointerLocked && this.isRunning && !this.isInventoryOpen) {
          const now = performance.now();
          if (now - this._pointerLockExitTime < 800) return;
          try {
            const p = this.canvas.requestPointerLock();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch(_) {}
        }
      };

      this.ui.startScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.startScreen.style.display = 'none';
        this.camera.position.set(this._spawnX, this._spawnY + this.player.eyeHeight, this._spawnZ);
        const lookDir = new THREE.Vector3(
          -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
          Math.sin(this.player.pitch),
          -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
        );
        this.camera.lookAt(
          this.camera.position.x + lookDir.x,
          this.camera.position.y + lookDir.y,
          this.camera.position.z + lookDir.z
        );
        requestLock();
      });

      this.ui.pauseScreen.addEventListener('click', requestLock);
      this.canvas.addEventListener('click', requestLock);
    }

    if (this.isMobile) {
      this.ui.startScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.startScreen.style.display = 'none';
        this.camera.position.set(this._spawnX, this._spawnY + this.player.eyeHeight, this._spawnZ);
        const lookDir = new THREE.Vector3(
          -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
          Math.sin(this.player.pitch),
          -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
        );
        this.camera.lookAt(
          this.camera.position.x + lookDir.x,
          this.camera.position.y + lookDir.y,
          this.camera.position.z + lookDir.z
        );
        this._showGameUI(true);
      });

      this.ui.pauseScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.pauseScreen.style.display = 'none';
        this._showGameUI(true);
      });

      this.touchController = new TouchController(this.player, this);
    }

    window.addEventListener('resize', () => this._onResize());

    // 玩家受击回调 - 显示红色叠加
    const origOnHPChanged = this.player.onHPChanged;
    this.player.onHPChanged = (hp, maxHP) => {
      this._updateHealthBar(hp, maxHP);
      this._showHitOverlay(this.player._lastDmgFrom);
    };
  }

  _showGameUI(show) {
    const display = show ? 'flex' : 'none';
    this.ui.crosshair.style.display = show ? 'block' : 'none';
    this.ui.selectedBlockName.style.display = show ? 'block' : 'none';
    this.ui.hotbar.style.display = this.isMobile ? 'none' : display;
    this.ui.debugInfo.style.display = show ? 'block' : 'none';
    this.ui.blockHighlight.style.display = 'none';

    if (!this.isMobile) {
      this.ui.controlsPanel.style.display = show ? 'flex' : 'none';
    }

    if (this.isMobile) {
      const mobileControls = document.getElementById('mobileControls');
      if (mobileControls) mobileControls.style.display = show ? 'block' : 'none';
    }

    // 血条和弹药HUD
    if (this._healthBarEl) {
      this._healthBarEl.style.display = show ? 'flex' : 'none';
    }
    if (this._ammoEl) {
      this._ammoEl.style.display = show ? 'block' : 'none';
    }
    // 任务面板
    const questPanel = document.getElementById('questPanel');
    if (questPanel) questPanel.style.display = show ? 'block' : 'none';
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _adjustFOV(delta) {
    this.fov = Math.max(this.fovMin, Math.min(this.fovMax, this.fov + delta));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this._showFOVHint();
  }

  _resetFOV() {
    this._adjustFOV(this.defaultFov - this.fov);
  }

  _weaponAttack() {
    const currentItem = this.inventory.getCurrentItem();
    if (!currentItem || currentItem.type !== 'weapon') return;

    const weaponType = currentItem.weaponType;
    const wDef = WeaponDefs[weaponType];
    if (!wDef) return;

    if (wDef.type === 'ranged') {
      // 换弹或冷却中不射击也不播放音效
      if (this.weaponManager.isReloading || this.weaponManager.cooldownTimer > 0) return;
      const shot = this.weaponManager.shoot(weaponType, this.player);
      if (shot === false) return; // 射击失败（无弹药等）
      // 根据武器类型传递不同音高和音量
      const pitchMap = {
        [WeaponType.PISTOL]: 900,
        [WeaponType.RIFLE]: 1100,
        [WeaponType.SNIPER]: 500,
      };
      if (weaponType === WeaponType.SHOTGUN) {
        audio.shotgun();
      } else if (weaponType === WeaponType.SMG) {
        audio.smg();
      } else {
        audio.shoot(pitchMap[weaponType] || 800);
      }
    } else if (wDef.type === 'grenade') {
      // 手榴弹投掷
      if (this.weaponManager.cooldownTimer > 0) return;
      const thrown = this.weaponManager.throwGrenade(this.player);
      if (thrown) {
        audio.swing(); // 投掷音效
        // 减少背包中的手榴弹数量
        const item = this.inventory.getCurrentItem();
        if (item) {
          item.count = this.weaponManager.grenadeCount;
          if (item.count <= 0) {
            this.inventory.slots[this.inventory.selectedSlot] = null;
          }
        }
      }
    } else {
      this.weaponManager.meleeAttack(weaponType, this.player);
      audio.swing();
    }

    this._updateHotbar();
  }

  _reloadWeapon() {
    const currentItem = this.inventory.getCurrentItem();
    if (!currentItem || currentItem.type !== 'weapon') return;

    const wDef = WeaponDefs[currentItem.weaponType];
    if (!wDef || wDef.type !== 'ranged') return;

    const ammoType = wDef.ammoType;
    if (!this.inventory.hasAmmo(ammoType, 1)) {
      this._showHint('没有弹药！');
      return;
    }

    this.weaponManager.startReload(currentItem.weaponType);
    audio.reload();
  }

  /** Q键快速切换武器 */
  _quickSwapWeapon() {
    if (this._lastWeaponSlot !== undefined && this._lastWeaponSlot !== this.inventory.selectedSlot) {
      const prevSlot = this.inventory.selectedSlot;
      this.inventory.selectedSlot = this._lastWeaponSlot;
      this._lastWeaponSlot = prevSlot;
    } else {
      // 切换到下一个有武器的槽位
      const start = this.inventory.selectedSlot;
      for (let i = 1; i <= this.inventory.cols; i++) {
        const idx = (start + i) % this.inventory.cols;
        const item = this.inventory.hotbar[idx];
        if (item && item.type === 'weapon') {
          this._lastWeaponSlot = this.inventory.selectedSlot;
          this.inventory.selectedSlot = idx;
          break;
        }
      }
    }
    this._updateHotbar();
  }

  /** Tab键切换设置面板 */
  _toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    if (!panel) return;

    if (panel.style.display === 'none') {
      panel.style.display = 'flex';
      try { document.exitPointerLock(); } catch(_) {}
    } else {
      panel.style.display = 'none';
      if (!this.isMobile) try { this.canvas.requestPointerLock(); } catch(_) {}
    }
  }

  /** 初始化设置滑块 */
  _initSettingsSliders() {
    const fovSlider = document.getElementById('settingFOV');
    const fovVal = document.getElementById('settingFOVVal');
    const sensSlider = document.getElementById('settingSens');
    const sensVal = document.getElementById('settingSensVal');
    const bobSlider = document.getElementById('settingBob');
    const bobVal = document.getElementById('settingBobVal');
    const smoothSlider = document.getElementById('settingSmooth');
    const smoothVal = document.getElementById('settingSmoothVal');

    if (fovSlider) {
      fovSlider.value = this.fov;
      if (fovVal) fovVal.textContent = this.fov;
      fovSlider.addEventListener('input', () => {
        const v = parseInt(fovSlider.value);
        this.fov = v;
        this.defaultFov = v;
        this.camera.fov = v;
        this.camera.updateProjectionMatrix();
        if (fovVal) fovVal.textContent = v;
      });
    }

    if (sensSlider) {
      sensSlider.value = Math.round(this.mouseSensitivity * 2500);
      if (sensVal) sensVal.textContent = sensSlider.value;
      sensSlider.addEventListener('input', () => {
        const v = parseInt(sensSlider.value);
        this.mouseSensitivity = v / 2500;
        if (sensVal) sensVal.textContent = v;
      });
    }

    if (bobSlider) {
      bobSlider.value = Math.round(this.bobIntensity * 10);
      if (bobVal) bobVal.textContent = bobSlider.value;
      bobSlider.addEventListener('input', () => {
        const v = parseInt(bobSlider.value);
        this.bobIntensity = v / 10;
        if (bobVal) bobVal.textContent = v;
      });
    }

    if (smoothSlider) {
      smoothSlider.value = Math.round(this.moveSmoothing * 10);
      if (smoothVal) smoothVal.textContent = smoothSlider.value;
      smoothSlider.addEventListener('input', () => {
        const v = parseInt(smoothSlider.value);
        this.moveSmoothing = v / 10;
        if (smoothVal) smoothVal.textContent = v;
      });
    }
  }

  _showHint(text) {
    let hint = document.getElementById('gameHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'gameHint';
      hint.style.cssText =
        'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);' +
        'color:#FFD700;font-size:22px;font-weight:bold;' +
        'text-shadow:0 2px 8px rgba(0,0,0,0.7);pointer-events:none;z-index:100;' +
        'transition:opacity 0.4s;';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    hint.style.opacity = '1';
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      hint.style.opacity = '0';
    }, 1500);
  }

  _showFOVHint() {
    if (this._fovHintTimer) clearTimeout(this._fovHintTimer);
    let hint = document.getElementById('fovHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'fovHint';
      hint.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'color:#fff;font-size:28px;font-weight:bold;' +
        'text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;z-index:100;' +
        'transition:opacity 0.3s;';
      document.body.appendChild(hint);
    }
    hint.textContent = `FOV: ${this.fov.toFixed(0)}°`;
    hint.style.opacity = '1';
    this._fovHintTimer = setTimeout(() => {
      hint.style.opacity = '0';
    }, 1200);
  }

  _updateDebugInfo() {
    const pos = this.player.position;
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    const chunks = this.world.chunks.size;

    let weaponInfo = '';
    const currentItem = this.inventory.getCurrentItem();
    if (currentItem && currentItem.type === 'weapon') {
      const wDef = WeaponDefs[currentItem.weaponType];
      if (wDef && wDef.type === 'ranged') {
        const ammoInfo = this.weaponManager.getAmmoInfo(currentItem.weaponType);
        if (ammoInfo) {
          const totalAmmo = this.inventory.getAmmoCount(wDef.ammoType);
          weaponInfo = `<br>武器: ${wDef.name} | ${ammoInfo.current}/${ammoInfo.max} | 备弹: ${totalAmmo}`;
        }
      } else if (wDef) {
        weaponInfo = `<br>武器: ${wDef.name}`;
      }
    }

    this.ui.debugInfo.innerHTML =
      `FPS: ${this.fps}<br>` +
      `FOV: ${this.fov.toFixed(0)}°<br>` +
      `HP: ${Math.ceil(this.player.hp)}/${this.player.maxHP}<br>` +
      `XYZ: ${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}<br>` +
      `区块: ${cx}, ${cz} | 已加载: ${chunks}<br>` +
      `机器人: ${this.animalManager ? this.animalManager.animals.length : 0} 只` +
      weaponInfo;

    this.ui.blockHighlight.style.display = 'none';
  }

  /** 主游戏循环 */
  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = this.clock.getDelta();

    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    // 移动端：从触控控制器注入键盘输入
    if (this.isMobile && this.touchController && this.isRunning) {
      const tc = this.touchController;
      const deadZone = 0.15;
      this.player.keys['KeyW'] = tc.moveZ < -deadZone;
      this.player.keys['KeyS'] = tc.moveZ > deadZone;
      this.player.keys['KeyA'] = tc.moveX < -deadZone;
      this.player.keys['KeyD'] = tc.moveX > deadZone;
    }

    // 更新游戏逻辑
    if (this.isPointerLocked || (this.isMobile && this.isRunning)) {
      this.player.update(dt);
      this.world.update(this.player.position.x, this.player.position.z);
      this.highlight.update(this.player.targetBlock);

      if (this.weaponManager) {
        const isMoving = this.player.keys['KeyW'] || this.player.keys['KeyA'] || this.player.keys['KeyS'] || this.player.keys['KeyD'];
        this.weaponManager.update(dt, isMoving, this.bobIntensity);

        // 自动射击：长按左键时，如果当前武器是 auto 类型则持续射击
        if (this._isFiring) {
          const currentItem = this.inventory.getCurrentItem();
          if (currentItem && currentItem.type === 'weapon') {
            const wDef = WeaponDefs[currentItem.weaponType];
            if (wDef && wDef.auto) {
              this._weaponAttack();
            }
          }
        }

        // 手榴弹抛物线轨迹 - 仅右键按住时显示
        if (this.grenadeTrajectory) {
          const currentItem = this.inventory.getCurrentItem();
          if (this._rightMouseDown && currentItem && currentItem.weaponType === WeaponType.GRENADE) {
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const wDef = WeaponDefs[WeaponType.GRENADE];
            this.grenadeTrajectory.show(this.camera.position.clone(), dir, wDef.throwSpeed || 20, this.world);
          } else {
            this.grenadeTrajectory.hide();
          }
        }

        // 脚步声
        if (isMoving && this.player.onGround) {
          this._footstepTimer += dt;
          if (this._footstepTimer > 0.45) {
            this._footstepTimer = 0;
            audio.step();
          }
        } else {
          this._footstepTimer = 0.3; // 接近下次触发
        }
      }
    }

    // 始终更新机器人 AI
    if (this.animalManager) {
      this.animalManager.update(dt);
    }

    // FOV 过渡（瞄准镜缩放）
    if (this.targetFov !== undefined) {
      const curFov = this.camera.fov;
      const diff = this.targetFov - curFov;
      if (Math.abs(diff) > 0.1) {
        this.camera.fov += diff * Math.min(1, dt * 12);
        this.camera.updateProjectionMatrix();
      } else if (curFov !== this.targetFov) {
        this.camera.fov = this.targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

    // 渲染
    try {
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      console.error('[Game] 渲染错误:', e.message, e.stack);
    }

    // 更新UI（降低频率）
    if (this.frameCount % 10 === 0) {
      this._updateDebugInfo();
    }

    // 命中标记计时 - 准心恢复
    if (this._hitMarkerTimer > 0) {
      this._hitMarkerTimer -= dt;
      if (this._hitMarkerTimer <= 0) {
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.classList.remove('hit');
      }
    }

    // 新手引导
    this._updateTutorial(dt);

    // 任务系统
    this._updateQuests(dt);
  }
}

// 启动游戏
const game = new Game();
game.init().then(() => {
  game.animate();
}).catch(e => {
  console.error('[Game] 启动失败:', e);
  alert('游戏启动失败: ' + e.message);
});
