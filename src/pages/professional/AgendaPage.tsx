import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, Users, Plus, Settings, AlertCircle, CreditCard, CheckCircle, XCircle } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO } from 'date-fns';
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

const AgendaPage: React.FC = () => {
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

  // Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');

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
          }

          // Fetch patients
          const patientsResponse = await fetch(`${apiUrl}/api/agenda/patients`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (patientsResponse.ok) {
            const patientsData = await patientsResponse.json();
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
    if (!selectedDate || !selectedTime || !selectedPatient) {
      setError('Preencha todos os campos obrigatórios');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const appointmentDate = new Date(selectedDate);
      const [hours, minutes] = selectedTime.split(':');
      appointmentDate.setHours(parseInt(hours), parseInt(minutes));

      const response = await fetch(`${apiUrl}/api/agenda/appointments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          patient_id: parseInt(selectedPatient),
          date: appointmentDate.toISOString(),
          notes: appointmentNotes
        })
      });

      if (response.ok) {
        setSuccess('Agendamento criado com sucesso!');
        setShowAppointmentModal(false);
        setSelectedDate(null);
        setSelectedTime('');
        setSelectedPatient('');
        setAppointmentNotes('');
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

  const handleSubscriptionPayment = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/create-subscription-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        window.open(data.init_point, '_blank');
      } else {
        const errorData = await response.json();
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
    return appointments.filter(appointment => 
      isSameDay(parseISO(appointment.date), date)
    );
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
            Pacientes
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
                        <div>{getStatusText(appointment.status)}</div>
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

      {/* Modals would go here - simplified for now */}
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
    </div>
  );
};

export default AgendaPage;