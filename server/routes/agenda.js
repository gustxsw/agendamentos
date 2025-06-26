import express from 'express';
import { pool } from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get professional's schedule configuration
router.get('/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM professional_schedules WHERE professional_id = $1',
      [req.user.id]
    );

    res.json(result.rows[0] || {
      professional_id: req.user.id,
      monday_start: null,
      monday_end: null,
      tuesday_start: null,
      tuesday_end: null,
      wednesday_start: null,
      wednesday_end: null,
      thursday_start: null,
      thursday_end: null,
      friday_start: null,
      friday_end: null,
      saturday_start: null,
      saturday_end: null,
      sunday_start: null,
      sunday_end: null,
      slot_duration: 30,
      break_start: null,
      break_end: null
    });
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao carregar configuração da agenda' });
  }
});

// Update professional's schedule configuration
router.put('/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      monday_start, monday_end,
      tuesday_start, tuesday_end,
      wednesday_start, wednesday_end,
      thursday_start, thursday_end,
      friday_start, friday_end,
      saturday_start, saturday_end,
      sunday_start, sunday_end,
      slot_duration,
      break_start, break_end
    } = req.body;

    const result = await pool.query(`
      INSERT INTO professional_schedules (
        professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, slot_duration, break_start, break_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (professional_id) 
      DO UPDATE SET
        monday_start = $2, monday_end = $3, tuesday_start = $4, tuesday_end = $5,
        wednesday_start = $6, wednesday_end = $7, thursday_start = $8, thursday_end = $9,
        friday_start = $10, friday_end = $11, saturday_start = $12, saturday_end = $13,
        sunday_start = $14, sunday_end = $15, slot_duration = $16, break_start = $17, break_end = $18,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro ao atualizar configuração da agenda' });
  }
});

// Get professional's patients
router.get('/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.birth_date, u.address,
             u.address_number, u.address_complement, u.neighborhood, u.city, u.state,
             pp.created_at as linked_at, pp.notes,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1
      ORDER BY u.name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro ao carregar pacientes' });
  }
});

// Add new patient (particular)
router.post('/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes
    } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, name, roles FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    let patientId;

    if (existingUser.rows.length > 0) {
      // User exists, check if already linked to this professional
      const existingLink = await pool.query(
        'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
        [req.user.id, existingUser.rows[0].id]
      );

      if (existingLink.rows.length > 0) {
        return res.status(400).json({ 
          message: 'Este paciente já está vinculado à sua agenda',
          existingPatient: existingUser.rows[0]
        });
      }

      patientId = existingUser.rows[0].id;
      
      // Link existing user to professional
      await pool.query(
        'INSERT INTO professional_patients (professional_id, patient_id, notes) VALUES ($1, $2, $3)',
        [req.user.id, patientId, notes]
      );
    } else {
      // Create new patient (without roles - particular patient)
      const newPatient = await pool.query(`
        INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, 
                          address_complement, neighborhood, city, state)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        name, cpf.replace(/\D/g, ''), email || null, phone?.replace(/\D/g, '') || null,
        birth_date || null, address || null, address_number || null,
        address_complement || null, neighborhood || null, city || null, state || null
      ]);

      patientId = newPatient.rows[0].id;

      // Link new patient to professional
      await pool.query(
        'INSERT INTO professional_patients (professional_id, patient_id, notes) VALUES ($1, $2, $3)',
        [req.user.id, patientId, notes]
      );
    }

    // Return the complete patient data
    const patientData = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.birth_date, u.address,
             u.address_number, u.address_complement, u.neighborhood, u.city, u.state,
             pp.created_at as linked_at, pp.notes,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1 AND pp.patient_id = $2
    `, [req.user.id, patientId]);

    res.status(201).json(patientData.rows[0]);
  } catch (error) {
    console.error('Error adding patient:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado no sistema' });
    } else {
      res.status(500).json({ message: 'Erro ao adicionar paciente' });
    }
  }
});

// Update patient notes
router.put('/patients/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { notes } = req.body;
    
    const result = await pool.query(
      'UPDATE professional_patients SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE professional_id = $2 AND patient_id = $3 RETURNING *',
      [notes, req.user.id, req.params.patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

// Get appointments for a date range
router.get('/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const result = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1 
        AND a.date >= $2 
        AND a.date <= $3
      ORDER BY a.date
    `, [req.user.id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao carregar agendamentos' });
  }
});

// Create new appointment
router.post('/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes } = req.body;

    // Verify patient is linked to this professional
    const patientLink = await pool.query(
      'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
      [req.user.id, patient_id]
    );

    if (patientLink.rows.length === 0) {
      return res.status(400).json({ message: 'Paciente não está vinculado à sua agenda' });
    }

    // Check for conflicts
    const conflict = await pool.query(
      'SELECT id FROM appointments WHERE professional_id = $1 AND date = $2 AND status != $3',
      [req.user.id, date, 'cancelled']
    );

    if (conflict.rows.length > 0) {
      return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, status, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.user.id, patient_id, date, 'scheduled', notes]);

    // Get complete appointment data
    const appointmentData = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.id = $1
    `, [result.rows[0].id]);

    res.status(201).json(appointmentData.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Update appointment
router.put('/appointments/:appointmentId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { date, status, notes } = req.body;
    
    // Check if appointment belongs to this professional
    const appointment = await pool.query(
      'SELECT id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.appointmentId, req.user.id]
    );

    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    // If changing date, check for conflicts
    if (date) {
      const conflict = await pool.query(
        'SELECT id FROM appointments WHERE professional_id = $1 AND date = $2 AND status != $3 AND id != $4',
        [req.user.id, date, 'cancelled', req.params.appointmentId]
      );

      if (conflict.rows.length > 0) {
        return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (date) {
      updateFields.push(`date = $${paramCount++}`);
      updateValues.push(date);
    }
    if (status) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }
    if (notes !== undefined) {
      updateFields.push(`notes = $${paramCount++}`);
      updateValues.push(notes);
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.appointmentId);

    const result = await pool.query(`
      UPDATE appointments 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, updateValues);

    // Get complete appointment data
    const appointmentData = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.id = $1
    `, [req.params.appointmentId]);

    res.json(appointmentData.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

// Delete appointment
router.delete('/appointments/:appointmentId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND professional_id = $3 RETURNING *',
      ['cancelled', req.params.appointmentId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json({ message: 'Agendamento cancelado com sucesso' });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Erro ao cancelar agendamento' });
  }
});

// Get blocked times
router.get('/blocked-times', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const result = await pool.query(`
      SELECT * FROM blocked_times 
      WHERE professional_id = $1 
        AND date >= $2 
        AND date <= $3
      ORDER BY date
    `, [req.user.id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching blocked times:', error);
    res.status(500).json({ message: 'Erro ao carregar horários bloqueados' });
  }
});

// Create blocked time
router.post('/blocked-times', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { date, reason } = req.body;

    const result = await pool.query(`
      INSERT INTO blocked_times (professional_id, date, reason)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.user.id, date, reason]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating blocked time:', error);
    res.status(500).json({ message: 'Erro ao bloquear horário' });
  }
});

// Delete blocked time
router.delete('/blocked-times/:blockedTimeId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM blocked_times WHERE id = $1 AND professional_id = $2 RETURNING *',
      [req.params.blockedTimeId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Horário bloqueado não encontrado' });
    }

    res.json({ message: 'Horário desbloqueado com sucesso' });
  } catch (error) {
    console.error('Error deleting blocked time:', error);
    res.status(500).json({ message: 'Erro ao desbloquear horário' });
  }
});

// Get patient history
router.get('/patients/:patientId/history', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Verify patient is linked to this professional
    const patientLink = await pool.query(
      'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
      [req.user.id, req.params.patientId]
    );

    if (patientLink.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const result = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             pr.diagnosis, pr.treatment, pr.observations
      FROM appointments a
      LEFT JOIN medical_records pr ON a.id = pr.appointment_id
      WHERE a.professional_id = $1 AND a.patient_id = $2
      ORDER BY a.date DESC
    `, [req.user.id, req.params.patientId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ message: 'Erro ao carregar histórico do paciente' });
  }
});

// Create/Update medical record
router.post('/appointments/:appointmentId/medical-record', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { diagnosis, treatment, observations } = req.body;

    // Verify appointment belongs to this professional
    const appointment = await pool.query(
      'SELECT id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.appointmentId, req.user.id]
    );

    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    const result = await pool.query(`
      INSERT INTO medical_records (appointment_id, professional_id, diagnosis, treatment, observations)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (appointment_id) 
      DO UPDATE SET
        diagnosis = $3, treatment = $4, observations = $5, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [req.params.appointmentId, req.user.id, diagnosis, treatment, observations]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving medical record:', error);
    res.status(500).json({ message: 'Erro ao salvar prontuário' });
  }
});

export default router;