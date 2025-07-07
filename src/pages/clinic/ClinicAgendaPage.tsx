import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Calendar, 
  Users, 
  Filter, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  AlertCircle, 
  CheckCircle, 
  Building2
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type ClinicProfessional = {
  id: number;
  name: string;
  professional_type: string;
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
  professional_id: number;
  professional_name: string;
};

const ClinicAgendaPage: React.FC = () => {
  const { user } = useAuth();
  const [professionals, setProfessionals] = useState<ClinicProfessional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
    fetchProfessionals();
  }, []);

  useEffect(() => {
    if (selectedProfessionalId) {
      fetchAppointments();
    }
  }, [selectedProfessionalId, currentWeek]);

  const fetchProfessionals = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/agenda/professionals`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setProfessionals(data);
        
        // Auto-select first professional if available
        if (data.length > 0) {
          setSelectedProfessionalId(data[0].id);
        }
      } else {
        throw new Error('Erro ao carregar profissionais');
      }
    } catch (error) {
      console.error('Error fetching professionals:', error);
      setError('Não foi possível carregar os profissionais');
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
        `${apiUrl}/api/clinic/agenda/appointments?professional_id=${selectedProfessionalId}&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setAppointments(data);
      } else {
        throw new Error('Erro ao carregar agendamentos');
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
      setError('Não foi possível carregar os agendamentos');
    }
  };

  const generateTimeSlots = () => {
    const slots = [];
    const start = new Date();
    start.setHours(8, 0, 0, 0);
    const end = new Date();
    end.setHours(18, 0, 0, 0);

    while (start < end) {
      slots.push(format(start, 'HH:mm'));
      start.setMinutes(start.getMinutes() + 30);
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

  if (isLoading && professionals.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando agenda...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Calendar className="h-8 w-8 text-purple-600 mr-3" />
            Agenda da Clínica
          </h1>
          <p className="text-gray-600">Visualize a agenda de cada profissional</p>
        </div>
      </div>

      {/* Professional Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Filter className="h-5 w-5 text-purple-600 mr-2" />
          <h2 className="text-lg font-semibold">Selecionar Profissional</h2>
        </div>

        {professionals.length === 0 ? (
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
              <p className="text-yellow-700">
                Nenhum profissional com acesso à agenda encontrado. Cadastre profissionais com tipo "Agenda" ou "Convênio e Agenda".
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {professionals.map(professional => (
              <button
                key={professional.id}
                onClick={() => setSelectedProfessionalId(professional.id)}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedProfessionalId === professional.id
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center">
                  <Users className="h-5 w-5 mr-2 text-gray-500" />
                  <span className="font-medium">{professional.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
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

      {selectedProfessionalId ? (
        <>
          {/* Week Navigation */}
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={() => setCurrentWeek(addDays(currentWeek, -7))}
              className="btn btn-outline flex items-center"
            >
              <ChevronLeft className="h-5 w-5 mr-1" />
              Semana Anterior
            </button>

            <h2 className="text-xl font-semibold">
              {format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "dd 'de' MMMM", { locale: ptBR })} - {' '}
              {format(endOfWeek(currentWeek, { weekStartsOn: 1 }), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </h2>

            <button
              onClick={() => setCurrentWeek(addDays(currentWeek, 7))}
              className="btn btn-outline flex items-center"
            >
              Próxima Semana
              <ChevronRight className="h-5 w-5 ml-1" />
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
              {generateTimeSlots().map((timeSlot) => (
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
                            href={`https://wa.me/55${appointment.patient_phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                              `Olá ${appointment.patient_name}, tudo bem? Gostaria de confirmar o seu agendamento no dia ${format(parseISO(appointment.date), "dd/MM/yyyy", { locale: ptBR })} às ${format(parseISO(appointment.date), "HH:mm", { locale: ptBR })} com ${appointment.professional_name}.`
                            )}`}
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
                            Confirmar
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Selecione um profissional
          </h3>
          <p className="text-gray-600">
            Escolha um profissional para visualizar sua agenda
          </p>
        </div>
      )}
    </div>
  );
};

export default ClinicAgendaPage;