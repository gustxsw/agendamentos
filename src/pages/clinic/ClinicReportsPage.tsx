import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  BarChart2, 
  Download, 
  Calendar, 
  Filter, 
  Users, 
  Building2,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type ClinicProfessional = {
  id: number;
  name: string;
  percentage: number;
};

type ProfessionalReport = {
  professional_id: number;
  professional_name: string;
  total_consultations: number;
  total_revenue: number;
  professional_payment: number;
  clinic_revenue: number;
};

type ConsultationDetail = {
  id: number;
  date: string;
  patient_name: string;
  service_name: string;
  value: number;
  professional_payment: number;
  clinic_revenue: number;
};

const ClinicReportsPage: React.FC = () => {
  const { user } = useAuth();
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  const [professionals, setProfessionals] = useState<ClinicProfessional[]>([]);
  const [professionalReports, setProfessionalReports] = useState<ProfessionalReport[]>([]);
  const [consultationDetails, setConsultationDetails] = useState<ConsultationDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  // Get default date range (current month)
  function getDefaultStartDate() {
    const date = new Date();
    date.setDate(1); // First day of current month
    return date.toISOString().split('T')[0];
  }
  
  function getDefaultEndDate() {
    const date = new Date();
    return date.toISOString().split('T')[0];
  }

  useEffect(() => {
    fetchProfessionals();
  }, []);

  useEffect(() => {
    if (professionals.length > 0) {
      fetchReports();
    }
  }, [startDate, endDate, professionals]);

  useEffect(() => {
    if (selectedProfessionalId) {
      fetchConsultationDetails();
    } else {
      setConsultationDetails([]);
    }
  }, [selectedProfessionalId, startDate, endDate]);

  const fetchProfessionals = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/professionals`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setProfessionals(data);
      } else {
        throw new Error('Erro ao carregar profissionais');
      }
    } catch (error) {
      console.error('Error fetching professionals:', error);
      setError('Não foi possível carregar os profissionais');
    }
  };

  const fetchReports = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      const response = await fetch(
        `${apiUrl}/api/clinic/reports?start_date=${startDate}&end_date=${endDate}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setProfessionalReports(data);
      } else {
        throw new Error('Erro ao carregar relatórios');
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
      setError('Não foi possível carregar os relatórios');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchConsultationDetails = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      const response = await fetch(
        `${apiUrl}/api/clinic/reports/professional/${selectedProfessionalId}?start_date=${startDate}&end_date=${endDate}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setConsultationDetails(data);
      } else {
        throw new Error('Erro ao carregar detalhes das consultas');
      }
    } catch (error) {
      console.error('Error fetching consultation details:', error);
      setError('Não foi possível carregar os detalhes das consultas');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReports();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  };

  // Calculate totals
  const calculateTotals = () => {
    if (professionalReports.length === 0) return { consultations: 0, revenue: 0, professionalPayment: 0, clinicRevenue: 0 };
    
    return professionalReports.reduce((totals, report) => {
      return {
        consultations: totals.consultations + report.total_consultations,
        revenue: totals.revenue + report.total_revenue,
        professionalPayment: totals.professionalPayment + report.professional_payment,
        clinicRevenue: totals.clinicRevenue + report.clinic_revenue
      };
    }, { consultations: 0, revenue: 0, professionalPayment: 0, clinicRevenue: 0 });
  };

  const totals = calculateTotals();

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <BarChart2 className="h-8 w-8 text-purple-600 mr-3" />
          Relatórios da Clínica
        </h1>
        <p className="text-gray-600">Visualize o desempenho financeiro da clínica e dos profissionais</p>
      </div>
      
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Calendar className="h-6 w-6 text-purple-600 mr-2" />
          <h2 className="text-xl font-semibold">Período de Análise</h2>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                Data Inicial
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
                required
              />
            </div>
            
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                Data Final
              </label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input"
                required
              />
            </div>
            
            <div className="flex items-end">
              <button
                type="submit"
                className={`btn btn-primary w-full ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                disabled={isLoading}
              >
                {isLoading ? 'Carregando...' : 'Atualizar Relatórios'}
              </button>
            </div>
          </div>
        </form>
      </div>
      
      {/* Error/Success Messages */}
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
      
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando relatórios...</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Total de Consultas</h3>
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{totals.consultations}</p>
              <p className="text-sm text-gray-500 mt-1">
                Atendimentos no período
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Faturamento Total</h3>
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totals.revenue)}</p>
              <p className="text-sm text-gray-500 mt-1">
                Valor bruto das consultas
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Pagamento aos Profissionais</h3>
                <Users className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totals.professionalPayment)}</p>
              <p className="text-sm text-gray-500 mt-1">
                Valor a pagar aos profissionais
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Receita da Clínica</h3>
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(totals.clinicRevenue)}</p>
              <p className="text-sm text-gray-500 mt-1">
                Valor líquido para a clínica
              </p>
            </div>
          </div>
          
          {/* Professionals Report */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center">
                <Building2 className="h-6 w-6 text-purple-600 mr-2" />
                <h2 className="text-xl font-semibold">Desempenho por Profissional</h2>
              </div>
              
              <button className="btn btn-outline flex items-center">
                <Download className="h-5 w-5 mr-2" />
                Exportar
              </button>
            </div>
            
            {professionalReports.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Nenhum dado disponível
                </h3>
                <p className="text-gray-600">
                  Não há dados de faturamento para o período selecionado.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-4 text-left font-medium text-gray-700">Profissional</th>
                      <th className="py-3 px-4 text-center font-medium text-gray-700">Porcentagem</th>
                      <th className="py-3 px-4 text-center font-medium text-gray-700">Consultas</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-700">Faturamento</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-700">Pagamento</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-700">Receita Clínica</th>
                      <th className="py-3 px-4 text-center font-medium text-gray-700">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {professionalReports.map((report) => (
                      <tr key={report.professional_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm text-gray-900 font-medium">{report.professional_name}</td>
                        <td className="py-3 px-4 text-sm text-gray-600 text-center">
                          {professionals.find(p => p.id === report.professional_id)?.percentage || 50}%
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600 text-center">{report.total_consultations}</td>
                        <td className="py-3 px-4 text-sm text-gray-900 text-right">{formatCurrency(report.total_revenue)}</td>
                        <td className="py-3 px-4 text-sm text-blue-600 text-right font-medium">{formatCurrency(report.professional_payment)}</td>
                        <td className="py-3 px-4 text-sm text-green-600 text-right font-medium">{formatCurrency(report.clinic_revenue)}</td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => setSelectedProfessionalId(
                              selectedProfessionalId === report.professional_id ? null : report.professional_id
                            )}
                            className={`px-3 py-1 text-xs rounded-full ${
                              selectedProfessionalId === report.professional_id
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {selectedProfessionalId === report.professional_id ? 'Ocultar' : 'Detalhes'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
          {/* Consultation Details */}
          {selectedProfessionalId && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">
                  Detalhes das Consultas - {professionalReports.find(p => p.professional_id === selectedProfessionalId)?.professional_name}
                </h2>
                <button
                  onClick={() => setSelectedProfessionalId(null)}
                  className="btn btn-outline"
                >
                  Fechar
                </button>
              </div>
              
              {consultationDetails.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhuma consulta encontrada
                  </h3>
                  <p className="text-gray-600">
                    Não há consultas registradas para este profissional no período selecionado.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="py-3 px-4 text-left font-medium text-gray-700">Data</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-700">Paciente</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-700">Serviço</th>
                        <th className="py-3 px-4 text-right font-medium text-gray-700">Valor</th>
                        <th className="py-3 px-4 text-right font-medium text-gray-700">Profissional</th>
                        <th className="py-3 px-4 text-right font-medium text-gray-700">Clínica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consultationDetails.map((consultation) => (
                        <tr key={consultation.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-600">{formatDate(consultation.date)}</td>
                          <td className="py-3 px-4 text-sm text-gray-900">{consultation.patient_name}</td>
                          <td className="py-3 px-4 text-sm text-gray-600">{consultation.service_name}</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-right">{formatCurrency(consultation.value)}</td>
                          <td className="py-3 px-4 text-sm text-blue-600 text-right">{formatCurrency(consultation.professional_payment)}</td>
                          <td className="py-3 px-4 text-sm text-green-600 text-right">{formatCurrency(consultation.clinic_revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={3} className="py-3 px-4 text-sm font-medium text-gray-700">Total</td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900 text-right">
                          {formatCurrency(consultationDetails.reduce((sum, c) => sum + c.value, 0))}
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-blue-600 text-right">
                          {formatCurrency(consultationDetails.reduce((sum, c) => sum + c.professional_payment, 0))}
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-green-600 text-right">
                          {formatCurrency(consultationDetails.reduce((sum, c) => sum + c.clinic_revenue, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ClinicReportsPage;