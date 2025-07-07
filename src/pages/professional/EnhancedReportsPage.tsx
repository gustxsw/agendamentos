import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  BarChart2, 
  Download, 
  Calendar, 
  Filter, 
  FileText, 
  DollarSign,
  Users,
  TrendingUp,
  Eye
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Link } from 'react-router-dom';

type ConsultationHistory = {
  id: number;
  consultation_id: number;
  date: string;
  patient_name: string;
  service_name: string;
  total_value: number;
  amount_to_pay: number;
  is_convenio_patient: boolean;
  has_medical_record: boolean;
};

type ReportSummary = {
  total_consultations: number;
  convenio_consultations: number;
  particular_consultations: number;
  total_revenue: number;
  convenio_revenue: number;
  particular_revenue: number;
  amount_to_pay: number;
};

const EnhancedReportsPage: React.FC = () => {
  const { user } = useAuth();
  const [consultations, setConsultations] = useState<ConsultationHistory[]>([]);
  const [filteredConsultations, setFilteredConsultations] = useState<ConsultationHistory[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter states
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());
  const [typeFilter, setTypeFilter] = useState<'all' | 'convenio' | 'particular'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

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
    // First day of current month, set to UTC to avoid timezone issues
    const firstDay = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
    return firstDay.toISOString().split('T')[0];
  }
  
  function getDefaultEndDate() {
    const date = new Date();
    // Current day, set to UTC to avoid timezone issues
    const today = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59));
    return today.toISOString().split('T')[0];
  }

  useEffect(() => {
    fetchConsultations();
  }, [startDate, endDate]);

  useEffect(() => {
    applyFilters();
  }, [consultations, typeFilter]);

  const fetchConsultations = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();      
      
      // Adjust dates to ensure full day coverage
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      
      // Set start date to beginning of day in UTC
      const adjustedStartDate = new Date(Date.UTC(
        startDateObj.getFullYear(),
        startDateObj.getMonth(),
        startDateObj.getDate(),
        0, 0, 0
      )).toISOString();
      
      // Set end date to end of day in UTC
      const adjustedEndDate = new Date(Date.UTC(
        endDateObj.getFullYear(),
        endDateObj.getMonth(),
        endDateObj.getDate(),
        23, 59, 59
      )).toISOString();
      
      const response = await fetch(
        `${apiUrl}/api/reports/professional-consultations?start_date=${adjustedStartDate}&end_date=${adjustedEndDate}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (!response.ok) {
        throw new Error('Falha ao carregar relatório');
      }
      
      const data = await response.json();
      setConsultations(data.consultations || []);
      setSummary(data.summary || null);
    } catch (error) {
      console.error('Error fetching consultations:', error);
      setError('Não foi possível carregar o relatório');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...consultations];

    // Apply type filter
    if (typeFilter === 'convenio') {
      filtered = filtered.filter(c => c.is_convenio_patient);
    } else if (typeFilter === 'particular') {
      filtered = filtered.filter(c => !c.is_convenio_patient);
    }

    setFilteredConsultations(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchConsultations();
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

  // Pagination
  const totalPages = Math.ceil(filteredConsultations.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentConsultations = filteredConsultations.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <BarChart2 className="h-8 w-8 text-red-600 mr-3" />
          Relatórios Profissionais
        </h1>
        <p className="text-gray-600">Visualize seu histórico de consultas e faturamento</p>
      </div>
      
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Calendar className="h-6 w-6 text-red-600 mr-2" />
          <h2 className="text-xl font-semibold">Filtros</h2>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
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

            <div>
              <label htmlFor="typeFilter" className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de Consulta
              </label>
              <select
                id="typeFilter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'convenio' | 'particular')}
                className="input"
              >
                <option value="all">Todas</option>
                <option value="convenio">Convênio</option>
                <option value="particular">Particular</option>
              </select>
            </div>
            
            <div className="flex items-end">
              <button
                type="submit"
                className={`btn btn-primary w-full ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                disabled={isLoading}
              >
                {isLoading ? 'Carregando...' : 'Atualizar Relatório'}
              </button>
            </div>
          </div>
        </form>
      </div>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}
      
      {summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Total de Consultas</h3>
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{summary.total_consultations}</p>
              <div className="text-sm text-gray-500 mt-1">
                <span className="text-green-600">{summary.convenio_consultations} convênio</span>
                <span className="mx-1">•</span>
                <span className="text-blue-600">{summary.particular_consultations} particular</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Faturamento Total</h3>
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.total_revenue)}</p>
              <div className="text-sm text-gray-500 mt-1">
                Receita bruta do período
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Receita Convênio</h3>
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.convenio_revenue)}</p>
              <div className="text-sm text-gray-500 mt-1">
                Consultas do convênio
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">A Pagar ao Convênio</h3>
                <DollarSign className="h-5 w-5 text-red-600" />
              </div>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.amount_to_pay)}</p>
              <div className="text-sm text-gray-500 mt-1">
                Valor a ser repassado
              </div>
            </div>
          </div>

          {/* Detailed Report */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center">
                <FileText className="h-6 w-6 text-red-600 mr-2" />
                <h2 className="text-xl font-semibold">Histórico Detalhado</h2>
              </div>
              
              <button className="btn btn-outline flex items-center">
                <Download className="h-5 w-5 mr-2" />
                Exportar
              </button>
            </div>

            {/* Filter Summary */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  Mostrando {filteredConsultations.length} consulta(s)
                  {typeFilter !== 'all' && ` • Tipo: ${typeFilter === 'convenio' ? 'Convênio' : 'Particular'}`}
                </span>
                <span className="text-gray-600">
                  Período: {format(new Date(startDate), "dd/MM/yyyy", { locale: ptBR })} a {format(new Date(endDate), "dd/MM/yyyy", { locale: ptBR })}
                </span>
              </div>
            </div>
            
            {filteredConsultations.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Nenhuma consulta encontrada
                </h3>
                <p className="text-gray-600">
                  Não há consultas para o período e filtros selecionados.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Data da Consulta</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Nome do Paciente</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Serviço Realizado</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Tipo</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Valor da Consulta</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Valor a Pagar</th>
                        <th className="text-center py-3 px-4 font-medium text-gray-700">Prontuário</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentConsultations.map((consultation) => (
                        <tr key={consultation.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {formatDate(consultation.date)}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {consultation.patient_name}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {consultation.service_name}
                          </td>
                          <td className="py-3 px-4 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              consultation.is_convenio_patient
                                ? 'bg-green-100 text-green-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {consultation.is_convenio_patient ? 'Convênio' : 'Particular'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-right font-medium">
                            {formatCurrency(consultation.total_value)}
                          </td>
                          <td className="py-3 px-4 text-sm text-right font-medium">
                            {consultation.is_convenio_patient ? (
                              <span className="text-red-600">{formatCurrency(consultation.amount_to_pay)}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {consultation.has_medical_record ? (
                              <Link
                                to={`/professional/medical-records/${consultation.consultation_id}`}
                                className="text-blue-600 hover:text-blue-800"
                                title="Ver Prontuário"
                              >
                                <Eye className="h-4 w-4 mx-auto" />
                              </Link>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6">
                    <div className="text-sm text-gray-600">
                      Mostrando {startIndex + 1} a {Math.min(endIndex, filteredConsultations.length)} de {filteredConsultations.length} consultas
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => goToPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Anterior
                      </button>
                      
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          className={`px-3 py-1 text-sm border rounded-md ${
                            currentPage === page
                              ? 'bg-red-600 text-white border-red-600'
                              : 'border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      
                      <button
                        onClick={() => goToPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Próxima
                      </button>
                    </div>
                  </div>
                )}

                {/* Summary Footer */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Total de Consultas:</span>
                      <span className="ml-2 text-gray-900">{filteredConsultations.length}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Faturamento Total:</span>
                      <span className="ml-2 text-gray-900">
                        {formatCurrency(filteredConsultations.reduce((sum, c) => sum + c.total_value, 0))}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Total a Pagar:</span>
                      <span className="ml-2 text-red-600 font-medium">
                        {formatCurrency(filteredConsultations.reduce((sum, c) => sum + (c.is_convenio_patient ? c.amount_to_pay : 0), 0))}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default EnhancedReportsPage;