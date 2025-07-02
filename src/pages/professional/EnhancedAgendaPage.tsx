import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, Users, Plus, Settings, AlertCircle, CreditCard, CheckCircle, XCircle, Edit, Trash2, Eye } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type SubscriptionStatus = {
  status: string;
  expires_at: string | null;
  days_remaining: number;
  can_use_agenda: boolean;
  last_payment?: string;
};

type Patient = {
  id: number;
  name: string;
  cpf: string;
  phone: string;
  is_convenio_patient: boolean;
};

type Appointment = {
  id: number;
  date: string;
  status: string;
  notes: string;
  patient_id: number;
  patient_name: string;
  patient_phone: string;
  is_convenio_patient: boolean;
  created_at: string;
  updated_at: string;
};

type ScheduleConfig = {
  professional_id: number;
  monday_start: string | null;
  monday_end: string | null;
  tuesday_start: string | null;
  tuesday_end: string | null;
  wednesday_start: string | null;
  wednesday_end: string | null;
  thursday_start: string | null;
  thursday_end: string | null;
  friday_start: string | null;
  friday_end: string | null;
  saturday_start: string | null;
  saturday_end: string | null;
  sunday_start: string | null;
  sunday_end: string | null;
  slot_duration: number;
  break_start: string | null;
  break_end: string | null;
};

const EnhancedAgendaPage: React.FC = () => {
  const { user } = useAuth();
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  // Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [appointmentStatus, setAppointmentStatus] = useState('scheduled');

  // Schedule config form
  const [configForm, setConfigForm] = useState({
    monday_start: '',
    monday_end: '',
    tuesday_start: '',
    tuesday_end: '',
    wednesday_start: '',
    wednesday_end: '',
    thursday_start: '',
    thursday_end: '',
    friday_start: '',
    friday_end: '',
    saturday_start: '',
    saturday_end: '',
    sunday_start: '',
    sunday_end: '',
    slot_duration: 30,
    break_start: '',
    break_end: ''
  });

  // Patient form
  const [patientForm, setPatientForm] = useState({
    name: '',
    cpf: '',
    phone: '',
    birth_date: '',
    notes: ''
  });

  // Get API URL
  const getApiUrl = () => {
    if (
      window.location.hostname === "cartaoquiroferreira.com.br" ||
      window.location.hostname === "www.cartaoquiroferreira.com.br"
    ) {
      return "https://www.cartaoquiroferreira.com.br";
    }
    return "http://localhost:3001";
  };

  // Load MercadoPago SDK
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.type = 'text/javascript';
    script.onload = () => {
      const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
      console.log('MercadoPago SDK loaded, Public Key:', publicKey ? 'Found' : 'Missing');
      
      if (publicKey && (window as any).MercadoPago) {
        try {
          new (window as any).MercadoPago(publicKey);
          console.log('MercadoPago SDK initialized successfully');
        } catch (error) {
          console.error('Error initializing MercadoPago SDK:', error);
        }
      } else {
        console.warn('MercadoPago public key not found or SDK not loaded');
      }
    };
    script.onerror = () => {
      console.error('Failed to load MercadoPago SDK');
    };
    document.body.appendChild(script);
    
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (subscriptionStatus?.can_use_agenda) {
      fetchAppointments();
    }
  }, [currentWeek, subscriptionStatus]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Fetching agenda data...');

      // Fetch subscription status
      const subscriptionResponse = await fetch(`${apiUrl}/api/agenda/subscription-status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (subscriptionResponse.ok) {
        const subscriptionData = await subscriptionResponse.json();
        console.log('Subscription data:', subscriptionData);
        setSubscriptionStatus(subscriptionData);

        if (subscriptionData.can_use_agenda) {
          // Fetch schedule config
          const configResponse = await fetch(`${apiUrl}/api/agenda/schedule-config`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (configResponse.ok) {
            const configData = await configResponse.json();
            console.log('Schedule config:', configData);
            setScheduleConfig(configData);
            
            // Update form with existing config
            if (configData) {
              setConfigForm({
                monday_start: configData.monday_start || '',
                monday_end: configData.monday_end || '',
                tuesday_start: configData.tuesday_start || '',
                tuesday_end: configData.tuesday_end || '',
                wednesday_start: configData.wednesday_start || '',
                wednesday_end: configData.wednesday_end || '',
                thursday_start: configData.thursday_start || '',
                thursday_end: configData.thursday_end || '',
                friday_start: configData.friday_start || '',
                friday_end: configData.friday_end || '',
                saturday_start: configData.saturday_start || '',
                saturday_end: configData.saturday_end || '',
                sunday_start: configData.sunday_start || '',
                sunday_end: configData.sunday_end || '',
                slot_duration: configData.slot_duration || 30,
                break_start: configData.break_start || '',
                break_end: configData.break_end || ''
              });
            }
          }

          // Fetch patients
          const patientsResponse = await fetch(`${apiUrl}/api/agenda/patients`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (patientsResponse.ok) {
            const patientsData = await patientsResponse.json();
            console.log('Patients data:', patientsData);
            setPatients(patientsData);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Erro ao carregar dados da agenda');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAppointments = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const startDate = startOfWeek(currentWeek, { weekStartsOn: 1 });
      const endDate = endOfWeek(currentWeek, { weekStartsOn: 1 });

      console.log('Fetching appointments for week:', {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });

      const response = await fetch(
        `${apiUrl}/api/agenda/appointments?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('Appointments fetched:', data);
        setAppointments(data);
      } else {
        console.error('Failed to fetch appointments:', response.status);
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
    }
  };

  const handleSaveScheduleConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Saving schedule config:', configForm);

      // Convert empty strings to null for time fields
      const configToSave = {
        ...configForm,
        monday_start: configForm.monday_start || null,
        monday_end: configForm.monday_end || null,
        tuesday_start: configForm.tuesday_start || null,
        tuesday_end: configForm.tuesday_end || null,
        wednesday_start: configForm.wednesday_start || null,
        wednesday_end: configForm.wednesday_end || null,
        thursday_start: configForm.thursday_start || null,
        thursday_end: configForm.thursday_end || null,
        friday_start: configForm.friday_start || null,
        friday_end: configForm.friday_end || null,
        saturday_start: configForm.saturday_start || null,
        saturday_end: configForm.saturday_end || null,
        sunday_start: configForm.sunday_start || null,
        sunday_end: configForm.sunday_end || null,
        break_start: configForm.break_start || null,
        break_end: configForm.break_end || null
      };

      const response = await fetch(`${apiUrl}/api/agenda/schedule-config`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configToSave)
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Schedule config saved:', data);
        setScheduleConfig(data);
        setSuccess('Configuração de horários salva com sucesso!');
        setShowConfigModal(false);
      } else {
        const errorData = await response.json();
        console.error('Error saving config:', errorData);
        setError(errorData.message || 'Erro ao salvar configuração');
      }
    } catch (error) {
      console.error('Error saving schedule config:', error);
      setError('Erro ao salvar configuração');
    }
  };

  const handleCreateAppointment = async () => {
    if (!selectedDate || !selectedTime || !selectedPatient) {
      setError('Preencha todos os campos obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      // Create date correctly
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const appointmentDateTime = `${dateStr}T${selectedTime}:00`;
      
      console.log('Creating appointment:', {
        patient_id: parseInt(selectedPatient),
        date: appointmentDateTime,
        status: appointmentStatus,
        notes: appointmentNotes
      });

      const response = await fetch(`${apiUrl}/api/agenda/appointments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          patient_id: parseInt(selectedPatient),
          date: appointmentDateTime,
          status: appointmentStatus,
          notes: appointmentNotes
        })
      });

      if (response.ok) {
        const newAppointment = await response.json();
        console.log('Appointment created:', newAppointment);
        
        setSuccess('Agendamento criado com sucesso!');
        setShowAppointmentModal(false);
        
        // Reset form
        setSelectedDate(null);
        setSelectedTime('');
        setSelectedPatient('');
        setAppointmentNotes('');
        setAppointmentStatus('scheduled');
        
        // Refresh appointments
        await fetchAppointments();
      } else {
        const errorData = await response.json();
        console.error('Error creating appointment:', errorData);
        setError(errorData.message || 'Erro ao criar agendamento');
      }
    } catch (error) {
      console.error('Error creating appointment:', error);
      setError('Erro ao criar agendamento');
    }
  };

  const handleUpdateAppointment = async (appointmentId: number, updates: Partial<Appointment>) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Updating appointment:', appointmentId, updates);

      const response = await fetch(`${apiUrl}/api/agenda/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        console.log('Appointment updated');
        setSuccess('Agendamento atualizado com sucesso!');
        await fetchAppointments();
      } else {
        const errorData = await response.json();
        console.error('Error updating appointment:', errorData);
        setError(errorData.message || 'Erro ao atualizar agendamento');
      }
    } catch (error) {
      console.error('Error updating appointment:', error);
      setError('Erro ao atualizar agendamento');
    }
  };

  const handleDeleteAppointment = async (appointmentId: number) => {
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) return;

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Deleting appointment:', appointmentId);

      const response = await fetch(`${apiUrl}/api/agenda/appointments/${appointmentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        console.log('Appointment deleted');
        setSuccess('Agendamento excluído com sucesso!');
        await fetchAppointments();
      } else {
        const errorData = await response.json();
        console.error('Error deleting appointment:', errorData);
        setError(errorData.message || 'Erro ao excluir agendamento');
      }
    } catch (error) {
      console.error('Error deleting appointment:', error);
      setError('Erro ao excluir agendamento');
    }
  };

  const handleCreatePatient = async () => {
    if (!patientForm.name || !patientForm.cpf) {
      setError('Nome e CPF são obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Creating patient:', patientForm);

      const response = await fetch(`${apiUrl}/api/agenda/patients`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...patientForm,
          cpf: patientForm.cpf.replace(/\D/g, ''),
          phone: patientForm.phone.replace(/\D/g, '')
        })
      });

      if (response.ok) {
        const newPatient = await response.json();
        console.log('Patient created:', newPatient);
        
        setPatients([...patients, newPatient]);
        setSuccess('Paciente adicionado com sucesso!');
        setShowPatientModal(false);
        
        // Reset form
        setPatientForm({
          name: '',
          cpf: '',
          phone: '',
          birth_date: '',
          notes: ''
        });
      } else {
        const errorData = await response.json();
        console.error('Error creating patient:', errorData);
        setError(errorData.message || 'Erro ao criar paciente');
      }
    } catch (error) {
      console.error('Error creating patient:', error);
      setError('Erro ao criar paciente');
    }
  };

  const handleSubscriptionPayment = async () => {
    try {
      setError('');
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('Creating agenda subscription payment...');

      const response = await fetch(`${apiUrl}/api/agenda/create-subscription-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Payment preference created:', data);
        
        // Open MercadoPago checkout in new tab
        window.open(data.init_point, '_blank');
        
        setSuccess('Redirecionando para o pagamento...');
      } else {
        const errorData = await response.json();
        console.error('Payment creation failed:', errorData);
        setError(errorData.message || 'Erro ao processar pagamento');
      }
    } catch (error) {
      console.error('Error creating payment:', error);
      setError('Erro ao processar pagamento');
    }
  };

  const generateTimeSlots = (startTime: string | null, endTime: string | null, duration: number = 30) => {
    if (!startTime || !endTime) return [];

    const slots = [];
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);

    while (start < end) {
      slots.push(format(start, 'HH:mm'));
      start.setMinutes(start.getMinutes() + duration);
    }

    return slots;
  };

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 1 });
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(start, i));
    }
    return days;
  };

  const getAppointmentsForDate = (date: Date) => {
    return appointments.filter(appointment => {
      try {
        const appointmentDate = parseISO(appointment.date);
        return isValid(appointmentDate) && isSameDay(appointmentDate, date);
      } catch (error) {
        console.error('Error parsing appointment date:', appointment.date, error);
        return false;
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-gray-100 text-gray-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'scheduled': return 'Agendado';
      case 'confirmed': return 'Confirmado';
      case 'in_progress': return 'Em Atendimento';
      case 'completed': return 'Finalizado';
      case 'cancelled': return 'Cancelado';
      default: return status;
    }
  };

  const formatTime = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'HH:mm') : '';
    } catch (error) {
      console.error('Error formatting time:', dateString, error);
      return '';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : dateString;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return dateString;
    }
  };

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando agenda...</p>
        </div>
      </div>
    );
  }

  // Show subscription required screen
  if (!subscriptionStatus?.can_use_agenda) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center mb-8">
          <Calendar className="h-16 w-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Agenda Profissional</h1>
          <p className="text-gray-600">Sistema completo de agendamento para profissionais de saúde</p>
        </div>

        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 mb-8">
          <div className="flex items-center">
            <AlertCircle className="h-6 w-6 text-yellow-600 mr-3" />
            <div>
              <h3 className="text-lg font-medium text-yellow-800">Assinatura Necessária</h3>
              <p className="text-yellow-700 mt-1">
                Para utilizar a agenda profissional, é necessário ter uma assinatura ativa.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-xl font-semibold mb-4">Funcionalidades Incluídas</h3>
            <ul className="space-y-3">
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Agenda semanal personalizada</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Cadastro de pacientes particulares</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Prontuários eletrônicos</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Confirmação via WhatsApp</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Relatórios de atendimento</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Bloqueio de horários</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Gestão de status das consultas</span>
              </li>
            </ul>
          </div>

          <div className="bg-red-50 rounded-xl border border-red-200 p-6">
            <div className="text-center">
              <CreditCard className="h-12 w-12 text-red-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-red-900 mb-2">Plano Mensal</h3>
              <div className="text-3xl font-bold text-red-600 mb-4">R$ 49,90</div>
              <p className="text-red-700 mb-6">Acesso completo por 30 dias</p>
              
              <button
                onClick={handleSubscriptionPayment}
                className="w-full btn btn-primary"
              >
                Assinar Agora
              </button>
              
              <p className="text-xs text-red-600 mt-3">
                Pagamento seguro via Mercado Pago
              </p>
            </div>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
            <div className="flex items-center">
              <XCircle className="h-5 w-5 text-red-600 mr-2" />
              <p className="text-red-700">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
            <div className="flex items-center">
              <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
              <p className="text-green-700">{success}</p>
            </div>
          </div>
        )}

        {subscriptionStatus && subscriptionStatus.status === 'expired' && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4">
            <div className="flex items-center">
              <XCircle className="h-5 w-5 text-red-600 mr-2" />
              <p className="text-red-700">
                Sua assinatura expirou em {subscriptionStatus.expires_at ? 
                  format(parseISO(subscriptionStatus.expires_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 
                  'data não disponível'
                }. Renove para continuar usando a agenda.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agenda Profissional</h1>
          <p className="text-gray-600">Gerencie seus agendamentos e pacientes</p>
        </div>

        <div className="flex items-center space-x-3">
          {subscriptionStatus && (
            <div className="bg-green-50 px-3 py-2 rounded-lg">
              <p className="text-sm text-green-700">
                <strong>Assinatura ativa</strong> - {subscriptionStatus.days_remaining} dias restantes
              </p>
            </div>
          )}

          <button
            onClick={() => setShowConfigModal(true)}
            className="btn btn-outline flex items-center"
          >
            <Settings className="h-5 w-5 mr-2" />
            Configurar Horários
          </button>

          <button
            onClick={() => setShowPatientModal(true)}
            className="btn btn-secondary flex items-center"
          >
            <Users className="h-5 w-5 mr-2" />
            Novo Paciente
          </button>

          <button
            onClick={() => setShowAppointmentModal(true)}
            className="btn btn-primary flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Novo Agendamento
          </button>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={() => setCurrentWeek(addDays(currentWeek, -7))}
          className="btn btn-outline"
        >
          ← Semana Anterior
        </button>

        <h2 className="text-xl font-semibold">
          {format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "dd 'de' MMMM", { locale: ptBR })} - {' '}
          {format(endOfWeek(currentWeek, { weekStartsOn: 1 }), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </h2>

        <button
          onClick={() => setCurrentWeek(addDays(currentWeek, 7))}
          className="btn btn-outline"
        >
          Próxima Semana →
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-8 border-b border-gray-200">
          <div className="p-4 bg-gray-50 font-medium text-gray-700">Horário</div>
          {getWeekDays().map((day, index) => (
            <div key={index} className="p-4 bg-gray-50 text-center">
              <div className="font-medium text-gray-700">
                {format(day, 'EEEE', { locale: ptBR })}
              </div>
              <div className="text-sm text-gray-500">
                {format(day, 'dd/MM')}
              </div>
            </div>
          ))}
        </div>

        {/* Time slots */}
        <div className="max-h-96 overflow-y-auto">
          {scheduleConfig && generateTimeSlots('08:00', '18:00', scheduleConfig.slot_duration).map((timeSlot) => (
            <div key={timeSlot} className="grid grid-cols-8 border-b border-gray-100">
              <div className="p-3 bg-gray-50 text-sm font-medium text-gray-600 border-r border-gray-200">
                {timeSlot}
              </div>
              {getWeekDays().map((day, dayIndex) => {
                const dayAppointments = getAppointmentsForDate(day).filter(apt => 
                  formatTime(apt.date) === timeSlot
                );

                return (
                  <div key={dayIndex} className="p-2 border-r border-gray-100 min-h-[60px]">
                    {dayAppointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className={`p-2 rounded text-xs ${getStatusColor(appointment.status)} mb-1 cursor-pointer hover:opacity-80`}
                        onClick={() => {
                          setSelectedAppointment(appointment);
                          setShowViewModal(true);
                        }}
                      >
                        <div className="font-medium">{appointment.patient_name}</div>
                        <div>{getStatusText(appointment.status)}</div>
                        {appointment.patient_phone && (
                          <a
                            href={`https://wa.me/55${appointment.patient_phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-600 hover:text-green-800 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            WhatsApp
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="fixed top-4 right-4 bg-green-50 text-green-600 p-4 rounded-lg shadow-lg z-50">
          {success}
        </div>
      )}

      {error && (
        <div className="fixed top-4 right-4 bg-red-50 text-red-600 p-4 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}

      {/* Schedule Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Configurar Horários de Atendimento</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                  const dayNames = {
                    monday: 'Segunda-feira',
                    tuesday: 'Terça-feira',
                    wednesday: 'Quarta-feira',
                    thursday: 'Quinta-feira',
                    friday: 'Sexta-feira',
                    saturday: 'Sábado',
                    sunday: 'Domingo'
                  };

                  return (
                    <div key={day} className="border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium mb-3">{dayNames[day as keyof typeof dayNames]}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">Início</label>
                          <input
                            type="time"
                            value={configForm[`${day}_start` as keyof typeof configForm] as string}
                            onChange={(e) => setConfigForm({
                              ...configForm,
                              [`${day}_start`]: e.target.value
                            })}
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">Fim</label>
                          <input
                            type="time"
                            value={configForm[`${day}_end` as keyof typeof configForm] as string}
                            onChange={(e) => setConfigForm({
                              ...configForm,
                              [`${day}_end`]: e.target.value
                            })}
                            className="input"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Duração do Slot (minutos)</label>
                  <select
                    value={configForm.slot_duration}
                    onChange={(e) => setConfigForm({...configForm, slot_duration: parseInt(e.target.value)})}
                    className="input"
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>60 minutos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Início do Intervalo</label>
                  <input
                    type="time"
                    value={configForm.break_start}
                    onChange={(e) => setConfigForm({...configForm, break_start: e.target.value})}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Fim do Intervalo</label>
                  <input
                    type="time"
                    value={configForm.break_end}
                    onChange={(e) => setConfigForm({...configForm, break_end: e.target.value})}
                    className="input"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveScheduleConfig}
                  className="btn btn-primary"
                >
                  Salvar Configuração
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Appointment Modal */}
      {showAppointmentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Novo Agendamento</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data
                </label>
                <input
                  type="date"
                  value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      try {
                        const date = new Date(e.target.value + 'T00:00:00');
                        if (isValid(date)) {
                          setSelectedDate(date);
                        }
                      } catch (error) {
                        console.error('Error setting date:', error);
                      }
                    } else {
                      setSelectedDate(null);
                    }
                  }}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Horário
                </label>
                <select
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="input"
                >
                  <option value="">Selecione um horário</option>
                  {generateTimeSlots('08:00', '18:00', 30).map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paciente
                </label>
                <select
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="input"
                >
                  <option value="">Selecione um paciente</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.name} {patient.is_convenio_patient ? '(Convênio)' : '(Particular)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={appointmentStatus}
                  onChange={(e) => setAppointmentStatus(e.target.value)}
                  className="input"
                >
                  <option value="scheduled">Agendado</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="in_progress">Em Atendimento</option>
                  <option value="completed">Finalizado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={appointmentNotes}
                  onChange={(e) => setAppointmentNotes(e.target.value)}
                  className="input min-h-[80px]"
                  placeholder="Observações sobre o agendamento..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAppointmentModal(false)}
                className="btn btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateAppointment}
                className="btn btn-primary"
              >
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patient Modal */}
      {showPatientModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Novo Paciente Particular</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  value={patientForm.name}
                  onChange={(e) => setPatientForm({...patientForm, name: e.target.value})}
                  className="input"
                  placeholder="Nome completo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CPF *
                </label>
                <input
                  type="text"
                  value={patientForm.cpf}
                  onChange={(e) => setPatientForm({...patientForm, cpf: e.target.value})}
                  className="input"
                  placeholder="000.000.000-00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={patientForm.phone}
                  onChange={(e) => setPatientForm({...patientForm, phone: e.target.value})}
                  className="input"
                  placeholder="(00) 00000-0000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de Nascimento
                </label>
                <input
                  type="date"
                  value={patientForm.birth_date}
                  onChange={(e) => setPatientForm({...patientForm, birth_date: e.target.value})}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={patientForm.notes}
                  onChange={(e) => setPatientForm({...patientForm, notes: e.target.value})}
                  className="input min-h-[80px]"
                  placeholder="Observações sobre o paciente..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowPatientModal(false)}
                className="btn btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreatePatient}
                className="btn btn-primary"
              >
                Adicionar Paciente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Appointment Modal */}
      {showViewModal && selectedAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Detalhes do Agendamento</h3>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    // Edit appointment
                    setSelectedDate(new Date(selectedAppointment.date));
                    setSelectedTime(formatTime(selectedAppointment.date));
                    setSelectedPatient(selectedAppointment.patient_id.toString());
                    setAppointmentNotes(selectedAppointment.notes || '');
                    setAppointmentStatus(selectedAppointment.status);
                    setShowViewModal(false);
                    setShowAppointmentModal(true);
                  }}
                  className="text-blue-600 hover:text-blue-800"
                  title="Editar"
                >
                  <Edit className="h-5 w-5" />
                </button>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    handleDeleteAppointment(selectedAppointment.id);
                  }}
                  className="text-red-600 hover:text-red-800"
                  title="Excluir"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="space-y-3">
              <div>
                <span className="font-medium">Paciente:</span> {selectedAppointment.patient_name}
              </div>
              <div>
                <span className="font-medium">Data:</span> {formatDate(selectedAppointment.date)}
              </div>
              <div>
                <span className="font-medium">Status:</span>{' '}
                <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(selectedAppointment.status)}`}>
                  {getStatusText(selectedAppointment.status)}
                </span>
              </div>
              {selectedAppointment.notes && (
                <div>
                  <span className="font-medium">Observações:</span>
                  <p className="mt-1 text-gray-600">{selectedAppointment.notes}</p>
                </div>
              )}
              {selectedAppointment.patient_phone && (
                <div>
                  <span className="font-medium">Telefone:</span> {selectedAppointment.patient_phone}
                  <a
                    href={`https://wa.me/55${selectedAppointment.patient_phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-green-600 hover:text-green-800"
                  >
                    WhatsApp
                  </a>
                </div>
              )}
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Alterar Status
              </label>
              <select
                value={selectedAppointment.status}
                onChange={(e) => {
                  handleUpdateAppointment(selectedAppointment.id, { status: e.target.value });
                  setSelectedAppointment({...selectedAppointment, status: e.target.value});
                }}
                className="input"
              >
                <option value="scheduled">Agendado</option>
                <option value="confirmed">Confirmado</option>
                <option value="in_progress">Em Atendimento</option>
                <option value="completed">Finalizado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowViewModal(false)}
                className="btn btn-secondary"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedAgendaPage;