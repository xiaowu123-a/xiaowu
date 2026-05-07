/**
 * Wow商城支付服务器
 * 支持：支付宝、微信支付、TRX、USDT
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// 加载环境变量
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== SendCloud 邮件服务配置 ====================
const SENDCLOUD_API_USER = process.env.SENDCLOUD_API_USER || '';
const SENDCLOUD_API_KEY = process.env.SENDCLOUD_API_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '2304386803@qq.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wow@num0ve.sendcloud.org';
const FROM_NAME = 'Wow商城';

// 发送订单通知邮件到管理员（通过 SendCloud API）
async function sendOrderNotifyEmail(order) {
    try {
        const paymentNames = {
            'alipay': '支付宝',
            'wechat': '微信支付',
            'trx': 'TRX',
            'usdt': 'USDT'
        };

        const emailHtml = `
                <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; color: #fff;">
                        <h2 style="margin: 0;">🔔 新订单通知</h2>
                        <p style="margin: 8px 0 0; opacity: 0.8;">Wow商城收到一笔新订单</p>
                    </div>
                    <div style="padding: 24px; background: #fff;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999; width: 100px;">订单号</td>
                                <td style="padding: 12px 0; font-weight: 600; color: #333;">${order.id}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999;">商品名称</td>
                                <td style="padding: 12px 0; color: #333;">${order.productName}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999;">购买数量</td>
                                <td style="padding: 12px 0; color: #333;">${order.quantity} 件</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999;">订单金额</td>
                                <td style="padding: 12px 0; font-weight: 700; color: #ff6b6b; font-size: 18px;">￥${order.amount}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999;">支付方式</td>
                                <td style="padding: 12px 0; color: #333;">${paymentNames[order.paymentMethod] || order.paymentMethod}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 12px 0; color: #999;">客户联系方式</td>
                                <td style="padding: 12px 0; font-weight: 600; color: #4A90D9; font-size: 16px;">${order.contact}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; color: #999;">下单时间</td>
                                <td style="padding: 12px 0; color: #333;">${new Date(order.createdAt).toLocaleString('zh-CN')}</td>
                            </tr>
                        </table>
                    </div>
                    <div style="padding: 16px 24px; background: #f8f9fa; text-align: center; color: #999; font-size: 12px;">
                        此邮件由 Wow商城系统自动发送，请及时处理订单
                    </div>
                </div>
        `;

        // SendCloud API 发送邮件（使用表单格式，不是JSON）
        // from 格式: 发件人名称<域名邮箱>
        const response = await axios.post('https://api.sendcloud.net/apiv2/mail/send',
            new URLSearchParams({
                apiUser: SENDCLOUD_API_USER,
                apiKey: SENDCLOUD_API_KEY,
                from: `Wow商城<${FROM_EMAIL}>`,
                to: ADMIN_EMAIL,
                subject: `🔔 新订单通知 - ${order.id}`,
                html: emailHtml
            })
        );

        if (response.data && response.data.result) {
            console.log(`✅ 订单通知邮件已发送到 ${ADMIN_EMAIL}`);
            return true;
        } else {
            console.error('❌ SendCloud返回错误:', response.data);
            return false;
        }
    } catch (error) {
        console.error('❌ 发送邮件失败:', error.message);
        return false;
    }
}

// 内存数据库（生产环境请使用真实数据库）
const db = {
    orders: new Map(),
    products: [
        { id: 1, name: '【双向号】🏴‍☠️混合国家老号 撸羊毛', price: 22.8, stock: 115 },
        { id: 2, name: '美国+1🇺🇸 精养月号', price: 26.6, stock: 2569 },
        { id: 3, name: '缅甸+95🇲🇲 精养月号', price: 25.6, stock: 1404 },
        { id: 4, name: '马来西亚+60🇲🇾 月号', price: 28.8, stock: 1036 },
        { id: 5, name: '泰国+66🇹🇭 精养月号', price: 32.79, stock: 889 },
        { id: 6, name: '英国+44🇬🇧 精养月号', price: 35.79, stock: 393 },
        { id: 7, name: '摩洛哥+212🇲🇦 月号', price: 26, stock: 1152 },
        { id: 8, name: '印度尼西亚+62🇮🇩 月号', price: 25.6, stock: 722 },
        { id: 9, name: '肯尼亚+254🇰🇪 月号', price: 24.5, stock: 541 },
        { id: 10, name: '尼泊尔+977🇳🇵 月号', price: 29.9, stock: 397 },
    ]
};

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../')));

// ==================== 工具函数 ====================

// 生成订单号
function generateOrderId() {
    const date = new Date();
    const prefix = 'WD';
    const dateStr = date.getFullYear() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `${prefix}${dateStr}${random}`;
}

// 签名生成（支付宝）
function generateAlipaySign(params, privateKey) {
    const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
        if (params[key] !== '' && params[key] !== undefined && params[key] !== null) {
            acc[key] = params[key];
        }
        return acc;
    }, {});
    
    const signString = Object.entries(sortedParams)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signString);
    return sign.sign(privateKey, 'base64');
}

// 微信支付签名
function generateWechatSign(params, apiKey) {
    const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
        if (params[key] !== '' && params[key] !== undefined) {
            acc[key] = params[key];
        }
        return acc;
    }, {});
    
    const signString = Object.entries(sortedParams)
        .map(([k, v]) => `${k}=${v}`)
        .join('&') + `&key=${apiKey}`;
    
    return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
}

// ==================== API路由 ====================

// 获取商品列表
app.get('/api/products', (req, res) => {
    res.json({
        success: true,
        data: db.products
    });
});

// 创建订单
app.post('/api/orders/create', async (req, res) => {
    try {
        const { productId, quantity, contact, paymentMethod } = req.body;
        
        // 验证参数
        if (!productId || !quantity || !contact || !paymentMethod) {
            return res.status(400).json({
                success: false,
                message: '参数不完整'
            });
        }
        
        // 查找商品
        const product = db.products.find(p => p.id === parseInt(productId));
        if (!product) {
            return res.status(404).json({
                success: false,
                message: '商品不存在'
            });
        }
        
        // 检查库存
        if (product.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: '库存不足'
            });
        }
        
        // 计算金额
        const paymentFees = {
            'alipay': 1.08,
            'wechat': 1.08,
            'trx': 1,
            'usdt': 1
        };
        
        const fee = paymentFees[paymentMethod] || 1;
        const amount = (product.price * quantity * fee).toFixed(2);
        
        // 创建订单
        const orderId = generateOrderId();
        const order = {
            id: orderId,
            productId: product.id,
            productName: product.name,
            quantity: parseInt(quantity),
            price: product.price,
            amount: parseFloat(amount),
            contact,
            paymentMethod,
            status: 'pending', // pending, paid, delivered, cancelled
            createdAt: new Date().toISOString(),
            paidAt: null,
            deliveredAt: null,
            qrCode: null,
            paymentData: null
        };
        
        // 保存订单
        db.orders.set(orderId, order);
        
        // 📧 发送订单通知邮件到管理员邮箱（异步，不阻塞响应）
        sendOrderNotifyEmail(order).then(sent => {
            if (!sent) {
                console.warn(`订单 ${orderId} 邮件发送失败，请检查邮件配置`);
            }
        });
        
        // 根据支付方式生成支付信息
        let paymentInfo = {};
        
        switch (paymentMethod) {
            case 'alipay':
                paymentInfo = await createAlipayOrder(order);
                break;
            case 'wechat':
                paymentInfo = await createWechatOrder(order);
                break;
            case 'trx':
            case 'usdt':
                paymentInfo = createCryptoOrder(order);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: '不支持的支付方式'
                });
        }
        
        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                paymentInfo
            }
        });
        
    } catch (error) {
        console.error('创建订单失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// 支付宝下单
async function createAlipayOrder(order) {
    // 这里接入真实的支付宝接口
    // 演示模式：返回模拟数据
    
    const qrData = `https://qr.alipay.com/${order.id}`;
    const qrCode = await QRCode.toDataURL(qrData);
    
    order.qrCode = qrCode;
    order.paymentData = { qrData };
    
    return {
        type: 'qrcode',
        qrCode: qrCode,
        payUrl: qrData
    };
}

// 微信下单
async function createWechatOrder(order) {
    // 这里接入真实的微信支付接口
    // 演示模式：返回模拟数据
    
    const qrData = `weixin://wxpay/bizpayurl?pr=${order.id}`;
    const qrCode = await QRCode.toDataURL(qrData);
    
    order.qrCode = qrCode;
    order.paymentData = { qrData };
    
    return {
        type: 'qrcode',
        qrCode: qrCode,
        payUrl: qrData
    };
}

// 加密货币下单
function createCryptoOrder(order) {
    // 生成加密货币收款地址
    const addresses = {
        'trx': 'TXqwertyuiopASDFGHJKLzxcvbnm1234567890',
        'usdt': 'TXqwertyuiopASDFGHJKLzxcvbnm1234567890'
    };
    
    const cryptoAmounts = {
        'trx': (order.amount / 0.1).toFixed(2), // 假设 TRX = 0.1 CNY
        'usdt': (order.amount / 7.2).toFixed(2) // 假设 USDT = 7.2 CNY
    };
    
    const address = addresses[order.paymentMethod];
    const cryptoAmount = cryptoAmounts[order.paymentMethod];
    
    order.paymentData = {
        address,
        cryptoAmount,
        currency: order.paymentMethod.toUpperCase()
    };
    
    return {
        type: 'crypto',
        address: address,
        amount: cryptoAmount,
        currency: order.paymentMethod.toUpperCase()
    };
}

// 查询订单状态
app.get('/api/orders/:orderId', (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.get(orderId);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: '订单不存在'
        });
    }
    
    res.json({
        success: true,
        data: {
            orderId: order.id,
            status: order.status,
            amount: order.amount,
            productName: order.productName,
            createdAt: order.createdAt,
            paidAt: order.paidAt
        }
    });
});

// 支付宝回调
app.post('/api/payment/alipay/notify', (req, res) => {
    // 验证签名
    // 更新订单状态
    // 发货处理
    
    console.log('支付宝回调:', req.body);
    res.send('success');
});

// 微信回调
app.post('/api/payment/wechat/notify', (req, res) => {
    // 验证签名
    // 更新订单状态
    // 发货处理
    
    console.log('微信回调:', req.body);
    res.set('Content-Type', 'application/xml');
    res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');
});

// 模拟支付成功（测试用）
app.post('/api/orders/:orderId/pay', (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.get(orderId);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: '订单不存在'
        });
    }
    
    // 更新订单状态
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    
    // 减少库存
    const product = db.products.find(p => p.id === order.productId);
    if (product) {
        product.stock -= order.quantity;
    }
    
    // 触发发货（实际项目中这里会调用发货服务）
    setTimeout(() => {
        deliverOrder(order);
    }, 2000);
    
    res.json({
        success: true,
        message: '支付成功',
        data: {
            orderId: order.id,
            status: order.status,
            paidAt: order.paidAt
        }
    });
});

// 发货处理
function deliverOrder(order) {
    order.status = 'delivered';
    order.deliveredAt = new Date().toISOString();
    
    // 生成卡密信息
    const cardInfo = generateCardInfo(order);
    order.cardInfo = cardInfo;
    
    // 发送通知（实际项目中这里会发送邮件/短信）
    console.log(`订单 ${order.id} 已发货，联系方式: ${order.contact}`);
    console.log(`卡密信息:`, cardInfo);
}

// 生成卡密
function generateCardInfo(order) {
    // 实际项目中从数据库获取真实卡密
    return {
        phoneNumber: '+1' + Math.floor(Math.random() * 10000000000),
        codeUrl: `https://api.example.com/code/${order.id}`,
        twoFaCode: Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    };
}

// 获取卡密（支付后）
app.get('/api/orders/:orderId/card', (req, res) => {
    const { orderId } = req.params;
    const order = db.orders.get(orderId);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: '订单不存在'
        });
    }
    
    if (order.status !== 'delivered') {
        return res.status(400).json({
            success: false,
            message: '订单未发货'
        });
    }
    
    res.json({
        success: true,
        data: order.cardInfo
    });
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        orders: db.orders.size
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🚀 Wow商城支付服务器已启动`);
    console.log(`📍 地址: http://localhost:${PORT}`);
    console.log(`📊 订单数: ${db.orders.size}`);
    console.log(`=================================`);
});

module.exports = app;
