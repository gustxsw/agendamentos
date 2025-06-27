import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Calendar, 
  Clock, 
  Users, 
  Plus, 
  Settings, 
  AlertCircle, 
  CreditCard, 
  CheckCircle, 
  XCircle,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Repeat
} from 'lucide-react';
import { 
  format, 
  addDays, 
  startOfWeek, 
  endOfWeek, 
  isSameDay, 
  parseISO, 
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addWeeks,
  subWeeks
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// 🔥 MERCADO PAGO SDK V2 INTEGRATION
declare global {
  interface Window {
    MercadoPago: any;
  }
}

type ViewMode = 'month' | 'week' | 'day';

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

type ProfessionalLocation = {
  id: number;
  clinic_name: string;
  address: string;
  is_main: boolean;
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
  location_id: number;
  location_name: string;
  is_recurring: boolean;
  recurrence_pattern: string;
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
  work_start: string;
  work_end: string;
};

const EnhancedAgendaPage: React.FC = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [locations, setLocations] = useState<ProfessionalLocation[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  // Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState('weekly');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');

  // Schedule config form
  const [configForm, setConfigForm] = useState({
    work_start: '08:00',
    work_end: '18:00',
    break_start: '12:00',
    break_end: '13:00',
    slot_duration: 30,
    monday_start: '08:00',
    monday_end: '18:00',
    tuesday_start: '08:00',
    tuesday_end: '18:00',
    wednesday_start: '08:00',
    wednesday_end: '18:00',
    thursday_start: '08:00',
    thursday_end: '18:00',
    friday_start: '08:00',
    friday_end: '18:00',
    saturday_start: '',
    saturday_end: '',
    sunday_start: '',
    sunday_end: ''
  });

  const getApiUrl = () => {
    if (
      window.location.hostname === "cartaoquiroferreira.com.br" ||
      window.location.hostname === "www.cartaoquiroferreira.com.br"
    ) {
      return "https://www.cartaoquiroferreira.com.br";
    }
    return "http://localhost:3001";
  };

  // 🔥 LOAD MERCADO PAGO SDK V2
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.type = 'text/javascript';
    script.onload = () => {
      const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
      console.log('🔥 MercadoPago SDK v2 loaded for agenda, Public Key:', publicKey ? 'Found' : 'Missing');
      
      if (publicKey && window.MercadoPago) {
        try {
          new window.MercadoPago(publicKey);
          console.log('✅ MercadoPago SDK v2 initialized successfully for agenda');
        } catch (error) {
          console.error('❌ Error initializing MercadoPago SDK v2:', error);
        }
      } else {
        console.warn('⚠️ MercadoPago public key not found or SDK not loaded');
      }
    };
    script.onerror = () => {
      console.error('❌ Failed to load MercadoPago SDK v2');
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
  }, [currentDate, viewMode, subscriptionStatus]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      // Fetch subscription status
      const subscriptionResponse = await fetch(`${apiUrl}/api/agenda/subscription-status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (subscriptionResponse.ok) {
        const subscriptionData = await subscriptionResponse.json();
        setSubscriptionStatus(subscriptionData);

        if (subscriptionData.can_use_agenda) {
          // Fetch schedule config
          const configResponse = await fetch(`${apiUrl}/api/agenda/schedule-config`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (configResponse.ok) {
            const configData = await configResponse.json();
            setScheduleConfig(configData);
            if (configData) {
              setConfigForm({
                work_start: configData.work_start || '08:00',
                work_end: configData.work_end || '18:00',
                break_start: configData.break_start || '12:00',
                break_end: configData.break_end || '13:00',
                slot_duration: configData.slot_duration || 30,
                monday_start: configData.monday_start || '08:00',
                monday_end: configData.monday_end || '18:00',
                tuesday_start: configData.tuesday_start || '08:00',
                tuesday_end: configData.tuesday_end || '18:00',
                wednesday_start: configData.wednesday_start || '08:00',
                wednesday_end: configData.wednesday_end || '18:00',
                thursday_start: configData.thursday_start || '08:00',
                thursday_end: configData.thursday_end || '18:00',
                friday_start: configData.friday_start || '08:00',
                friday_end: configData.friday_end || '18:00',
                saturday_start: configData.saturday_start || '',
                saturday_end: configData.saturday_end || '',
                sunday_start: configData.sunday_start || '',
                sunday_end: configData.sunday_end || ''
              });
            }
          }

          // Fetch patients
          const patientsResponse = await fetch(`${apiUrl}/api/agenda/patients`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (patientsResponse.ok) {
            const patientsData = await patientsResponse.json();
            setPatients(patientsData);
          }

          // Fetch locations
          const locationsResponse = await fetch(`${apiUrl}/api/professional-locations`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (locationsResponse.ok) {
            const locationsData = await locationsResponse.json();
            setLocations(locationsData);
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

      let startDate, endDate;

      switch (viewMode) {
        case 'month':
          startDate = startOfMonth(currentDate);
          endDate = endOfMonth(currentDate);
          break;
        case 'week':
          startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
          endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
          break;
        case 'day':
          startDate = currentDate;
          endDate = currentDate;
          break;
      }

      const response = await fetch(
        `${apiUrl}/api/agenda/appointments?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setAppointments(data);
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
    }
  };

  const handleCreateAppointment = async () => {
    if (!selectedDate || !selectedTime || !selectedPatient || !selectedLocation) {
      setError('Preencha todos os campos obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const appointmentDate = new Date(selectedDate);
      const [hours, minutes] = selectedTime.split(':');
      appointmentDate.setHours(parseInt(hours), parseInt(minutes));

      const appointmentData = {
        patient_id: parseInt(selectedPatient),
        location_id: parseInt(selectedLocation),
        date: appointmentDate.toISOString(),
        notes: appointmentNotes,
        is_recurring: isRecurring,
        recurrence_pattern: isRecurring ? recurrencePattern : null,
        recurrence_end: isRecurring && recurrenceEnd ? new Date(recurrenceEnd).toISOString() : null
      };

      const response = await fetch(`${apiUrl}/api/agenda/appointments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(appointmentData)
      });

      if (response.ok) {
        setSuccess(isRecurring ? 'Agendamentos recorrentes criados com sucesso!' : 'Agendamento criado com sucesso!');
        setShowAppointmentModal(false);
        resetAppointmentForm();
        fetchAppointments();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao criar agendamento');
      }
    } catch (error) {
      console.error('Error creating appointment:', error);
      setError('Erro ao criar agendamento');
    }
  };

  const handleSaveConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/schedule-config`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configForm)
      });

      if (response.ok) {
        setSuccess('Configuração salva com sucesso!');
        setShowConfigModal(false);
        fetchData();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao salvar configuração');
      }
    } catch (error) {
      console.error('Error saving config:', error);
      setError('Erro ao salvar configuração');
    }
  };

  // 🔥 HANDLE SUBSCRIPTION PAYMENT WITH SDK V2
  const handleSubscriptionPayment = async () => {
    try {
      setError('');
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      console.log('🔄 Creating agenda subscription payment...');

      const response = await fetch(`${apiUrl}/api/agenda/create-subscription-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Payment preference created:', data);
        
        // Open MercadoPago checkout in new tab
        window.open(data.init_point, '_blank');
        
        setSuccess('Redirecionando para o pagamento...');
      } else {
        const errorData = await response.json();
        console.error('❌ Payment creation failed:', errorData);
        setError(errorData.message || 'Erro ao processar pagamento');
      }
    } catch (error) {
      console.error('❌ Error creating payment:', error);
      setError('Erro ao processar pagamento');
    }
  };

  const resetAppointmentForm = () => {
    setSelectedDate(null);
    setSelectedTime('');
    setSelectedPatient('');
    setSelectedLocation('');
    setAppointmentNotes('');
    setIsRecurring(false);
    setRecurrencePattern('weekly');
    setRecurrenceEnd('');
  };

  const generateTimeSlots = (startTime: string | null, endTime: string | null, duration: number = 30) => {
    if (!startTime || !endTime) return [];

    const slots = [];
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const breakStart = scheduleConfig?.break_start ? new Date(`2000-01-01T${scheduleConfig.break_start}`) : null;
    const breakEnd = scheduleConfig?.break_end ? new Date(`2000-01-01T${scheduleConfig.break_end}`) : null;

    while (start < end) {
      const currentTime = format(start, 'HH:mm');
      
      // Skip break time
      if (breakStart && breakEnd && start >= breakStart && start < breakEnd) {
        start.setMinutes(start.getMinutes() + duration);
        continue;
      }

      slots.push(currentTime);
      start.setMinutes(start.getMinutes() + duration);
    }

    return slots;
  };

  const getDateRange = () => {
    switch (viewMode) {
      case 'month':
        return eachDayOfInterval({
          start: startOfMonth(currentDate),
          end: endOfMonth(currentDate)
        });
      case 'week':
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        const days = [];
        for (let i = 0; i < 7; i++) {
          days.push(addDays(start, i));
        }
        return days;
      case 'day':
        return [currentDate];
      default:
        return [];
    }
  };

  const getAppointmentsForDate = (date: Date) => {
    return appointments.filter(appointment => 
      isSameDay(parseISO(appointment.date), date)
    );
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    switch (viewMode) {
      case 'month':
        setCurrentDate(direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(direction === 'next' ? addDays(currentDate, 1) : addDays(currentDate, -1));
        break;
    }
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
                <span>Visualização por mês, semana e dia</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Múltiplos locais de atendimento</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Agendamentos recorrentes</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Horário de intervalo configurável</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Cadastro de pacientes particulares</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <span>Confirmação via WhatsApp</span>
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
            Configurar
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

      {/* View Mode Selector */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewMode('month')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'month' 
                ? 'bg-red-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Mês
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'week' 
                ? 'bg-red-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Semana
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'day' 
                ? 'bg-red-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Dia
          </button>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigateDate('prev')}
            className="p-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <h2 className="text-xl font-semibold min-w-[200px] text-center">
            {viewMode === 'month' && format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}
            {viewMode === 'week' && (
              <>
                {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd 'de' MMM", { locale: ptBR })} - {' '}
                {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
              </>
            )}
            {viewMode === 'day' && format(currentDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </h2>

          <button
            onClick={() => navigateDate('next')}
            className="p-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>

        <button
          onClick={() => setCurrentDate(new Date())}
          className="btn btn-outline"
        >
          Hoje
        </button>
      </div>

      {/* Calendar View */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {viewMode === 'month' && (
          <div className="grid grid-cols-7 gap-px bg-gray-200">
            {/* Header */}
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day) => (
              <div key={day} className="bg-gray-50 p-4 text-center font-medium text-gray-700">
                {day}
              </div>
            ))}
            
            {/* Days */}
            {getDateRange().map((date, index) => {
              const dayAppointments = getAppointmentsForDate(date);
              const isCurrentMonth = isSameMonth(date, currentDate);
              const isCurrentDay = isToday(date);
              
              return (
                <div
                  key={index}
                  className={`bg-white p-2 min-h-[120px] ${
                    !isCurrentMonth ? 'text-gray-400' : ''
                  } ${isCurrentDay ? 'bg-red-50' : ''}`}
                >
                  <div className={`text-sm font-medium mb-2 ${
                    isCurrentDay ? 'text-red-600' : 'text-gray-900'
                  }`}>
                    {format(date, 'd')}
                  </div>
                  
                  <div className="space-y-1">
                    {dayAppointments.slice(0, 3).map((appointment) => (
                      <div
                        key={appointment.id}
                        className={`text-xs p-1 rounded ${getStatusColor(appointment.status)}`}
                      >
                        <div className="font-medium truncate">{appointment.patient_name}</div>
                        <div className="truncate">{format(parseISO(appointment.date), 'HH:mm')}</div>
                      </div>
                    ))}
                    {dayAppointments.length > 3 && (
                      <div className="text-xs text-gray-500">
                        +{dayAppointments.length - 3} mais
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === 'week' && (
          <div className="grid grid-cols-8 border-b border-gray-200">
            <div className="p-4 bg-gray-50 font-medium text-gray-700">Horário</div>
            {getDateRange().map((day, index) => (
              <div key={index} className="p-4 bg-gray-50 text-center">
                <div className="font-medium text-gray-700">
                  {format(day, 'EEEE', { locale: ptBR })}
                </div>
                <div className={`text-sm ${isToday(day) ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                  {format(day, 'dd/MM')}
                </div>
              </div>
            ))}
          </div>
        )}

        {(viewMode === 'week' || viewMode === 'day') && (
          <div className="max-h-96 overflow-y-auto">
            {scheduleConfig && generateTimeSlots(
              scheduleConfig.work_start, 
              scheduleConfig.work_end, 
              scheduleConfig.slot_duration
            ).map((timeSlot) => (
              <div key={timeSlot} className={`grid ${viewMode === 'week' ? 'grid-cols-8' : 'grid-cols-2'} border-b border-gray-100`}>
                <div className="p-3 bg-gray-50 text-sm font-medium text-gray-600 border-r border-gray-200">
                  {timeSlot}
                </div>
                {getDateRange().map((day, dayIndex) => {
                  const dayAppointments = getAppointmentsForDate(day).filter(apt => 
                    format(parseISO(apt.date), 'HH:mm') === timeSlot
                  );

                  return (
                    <div key={dayIndex} className="p-2 border-r border-gray-100 min-h-[60px]">
                      {dayAppointments.map((appointment) => (
                        <div
                          key={appointment.id}
                          className={`p-2 rounded text-xs ${getStatusColor(appointment.status)} mb-1`}
                        >
                          <div className="font-medium">{appointment.patient_name}</div>
                          <div className="flex items-center">
                            <MapPin className="h-3 w-3 mr-1" />
                            <span className="truncate">{appointment.location_name}</span>
                          </div>
                          <div>{getStatusText(appointment.status)}</div>
                          {appointment.is_recurring && (
                            <div className="flex items-center mt-1">
                              <Repeat className="h-3 w-3 mr-1" />
                              <span>Recorrente</span>
                            </div>
                          )}
                          {appointment.patient_phone && (
                            <a
                              href={`https://wa.me/55${appointment.patient_phone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 hover:text-green-800 text-xs"
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
        )}
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

      {/* Appointment Modal */}
      {showAppointmentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Novo Agendamento</h3>
                <button
                  onClick={() => setShowAppointmentModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
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
                    {scheduleConfig && generateTimeSlots(
                      scheduleConfig.work_start, 
                      scheduleConfig.work_end, 
                      scheduleConfig.slot_duration
                    ).map((time) => (
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
                    Local de Atendimento
                  </label>
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="input"
                  >
                    <option value="">Selecione um local</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.clinic_name} {location.is_main ? '(Principal)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                      className="rounded border-gray-300 text-red-600 shadow-sm focus:border-red-300 focus:ring focus:ring-red-200 focus:ring-opacity-50"
                    />
                    <span className="ml-2 text-sm text-gray-600">
                      Agendamento recorrente
                    </span>
                  </label>
                </div>

                {isRecurring && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Padrão de Recorrência
                      </label>
                      <select
                        value={recurrencePattern}
                        onChange={(e) => setRecurrencePattern(e.target.value)}
                        className="input"
                      >
                        <option value="weekly">Semanal</option>
                        <option value="biweekly">Quinzenal</option>
                        <option value="monthly">Mensal</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Data Final da Recorrência
                      </label>
                      <input
                        type="date"
                        value={recurrenceEnd}
                        onChange={(e) => setRecurrenceEnd(e.target.value)}
                        className="input"
                      />
                    </div>
                  </>
                )}

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
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Configurar Horários</h3>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* General Settings */}
                <div>
                  <h4 className="text-md font-medium mb-4">Configurações Gerais</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Início do Expediente
                      </label>
                      <input
                        type="time"
                        value={configForm.work_start}
                        onChange={(e) => setConfigForm({...configForm, work_start: e.target.value})}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Fim do Expediente
                      </label>
                      <input
                        type="time"
                        value={configForm.work_end}
                        onChange={(e) => setConfigForm({...configForm, work_end: e.target.value})}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Duração da Consulta (min)
                      </label>
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
                  </div>
                </div>

                {/* Break Time */}
                <div>
                  <h4 className="text-md font-medium mb-4">Horário de Intervalo</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Início do Intervalo
                      </label>
                      <input
                        type="time"
                        value={configForm.break_start}
                        onChange={(e) => setConfigForm({...configForm, break_start: e.target.value})}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Fim do Intervalo
                      </label>
                      <input
                        type="time"
                        value={configForm.break_end}
                        onChange={(e) => setConfigForm({...configForm, break_end: e.target.value})}
                        className="input"
                      />
                    </div>
                  </div>
                </div>

                {/* Weekly Schedule */}
                <div>
                  <h4 className="text-md font-medium mb-4">Horários por Dia da Semana</h4>
                  <div className="space-y-4">
                    {[
                      { key: 'monday', label: 'Segunda-feira' },
                      { key: 'tuesday', label: 'Terça-feira' },
                      { key: 'wednesday', label: 'Quarta-feira' },
                      { key: 'thursday', label: 'Quinta-feira' },
                      { key: 'friday', label: 'Sexta-feira' },
                      { key: 'saturday', label: 'Sábado' },
                      { key: 'sunday', label: 'Domingo' }
                    ].map(({ key, label }) => (
                      <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                        <div className="font-medium text-gray-700">{label}</div>
                        <div>
                          <input
                            type="time"
                            value={configForm[`${key}_start` as keyof typeof configForm] as string}
                            onChange={(e) => setConfigForm({
                              ...configForm, 
                              [`${key}_start`]: e.target.value
                            })}
                            className="input"
                            placeholder="Início"
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={configForm[`${key}_end` as keyof typeof configForm] as string}
                            onChange={(e) => setConfigForm({
                              ...configForm, 
                              [`${key}_end`]: e.target.value
                            })}
                            className="input"
                            placeholder="Fim"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
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
                  onClick={handleSaveConfig}
                  className="btn btn-primary"
                >
                  Salvar Configuração
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedAgendaPage;