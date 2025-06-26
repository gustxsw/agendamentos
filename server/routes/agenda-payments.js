import express from 'express';
import { pool } from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import mercadopago from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Configure MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Get professional's agenda subscription status
router.get('/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM agenda_subscriptions 
      WHERE professional_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [req.user.id]);

    const subscription = result.rows[0];
    
    if (!subscription) {
      return res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const now = new Date();
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    const canUseAgenda = subscription.status === 'active' && expiresAt > now;

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.created_at
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura' });
  }
});

// Get payment history
router.get('/payment-history', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ap.*, as_sub.expires_at
      FROM agenda_payments ap
      LEFT JOIN agenda_subscriptions as_sub ON ap.subscription_id = as_sub.id
      WHERE ap.professional_id = $1
      ORDER BY ap.created_at DESC
      LIMIT 10
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ message: 'Erro ao carregar histórico de pagamentos' });
  }
});

// Create agenda subscription payment
router.post('/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const amount = 49.90; // Fixed monthly price for agenda access

    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professional = professionalResult.rows[0];

    // Create preference for MercadoPago
    const preference = {
      items: [
        {
          title: 'Assinatura Agenda Quiro Ferreira - Mensal',
          description: 'Acesso completo à agenda profissional por 30 dias',
          unit_price: amount,
          quantity: 1,
          currency_id: 'BRL',
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || `professional${professionalId}@quiroferreira.com.br`,
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`,
      },
      auto_return: 'approved',
      external_reference: `agenda_${professionalId}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/agenda-payments/webhook`,
      statement_descriptor: 'QUIRO FERREIRA AGENDA',
    };

    const response = await mercadopago.preferences.create(preference);

    // Save payment record as pending
    const paymentResult = await pool.query(`
      INSERT INTO agenda_payments (professional_id, amount, status, mp_preference_id, external_reference)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [professionalId, amount, 'pending', response.body.id, preference.external_reference]);

    res.json({
      payment_id: paymentResult.rows[0].id,
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura' });
  }
});

// Webhook for payment notifications
router.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      const payment = await mercadopago.payment.findById(paymentId);
      const paymentData = payment.body;

      console.log('📧 Agenda payment webhook received:', {
        id: paymentId,
        status: paymentData.status,
        external_reference: paymentData.external_reference
      });

      if (paymentData.external_reference && paymentData.external_reference.startsWith('agenda_')) {
        // Update payment status in database
        const updateResult = await pool.query(`
          UPDATE agenda_payments 
          SET status = $1, mp_payment_id = $2, payment_data = $3, updated_at = CURRENT_TIMESTAMP
          WHERE external_reference = $4
          RETURNING *
        `, [
          paymentData.status,
          paymentId,
          JSON.stringify(paymentData),
          paymentData.external_reference
        ]);

        if (updateResult.rows.length > 0 && paymentData.status === 'approved') {
          const payment = updateResult.rows[0];
          
          // Create or extend subscription
          const now = new Date();
          const expiresAt = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days

          const subscriptionResult = await pool.query(`
            INSERT INTO agenda_subscriptions (professional_id, status, expires_at, payment_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
          `, [payment.professional_id, 'active', expiresAt, payment.id]);

          // Update payment with subscription reference
          await pool.query(`
            UPDATE agenda_payments 
            SET subscription_id = $1
            WHERE id = $2
          `, [subscriptionResult.rows[0].id, payment.id]);

          console.log('✅ Agenda subscription activated for professional:', payment.professional_id);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing agenda payment webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
});

export default router;