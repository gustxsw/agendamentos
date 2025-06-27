import React, { useState, useEffect } from 'react';
import { BarChart2, Download, Calendar, Users, DollarSign, TrendingUp, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type NewClientsReport = {
  total_new_clients: number;
  subscription_revenue: number;
  clients_by_month: {
    month: string;
    count: number;
    revenue: number;
  }[];
};

type ProfessionalRevenueReport = {
  total_revenue: number;
  revenue_by_professional: {
    professional_name: string;
    professional_percentage: number;
    revenue: number;
    consultation_count: number;
    professional_payment: number;
    clinic_revenue: number;
  }[];
  revenue_by_service: {
    service_name: string;
    revenue: number;
    consultation_count: number;
  }[];
};

type TotalRevenueReport = {
  subscription_revenue: number;
  consultation_revenue: number;
  total_revenue: number;
  clinic_total_revenue: number;
};

const EnhancedReportsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'new-clients' | 'professional-revenue' | 'total-revenue' | 'detailed'>('new-clients');
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Report data
  const [newClientsReport, setNewClientsReport] = useState<NewClientsReport | null>(null);
  const [professionalRevenueReport, setProfessionalRevenueReport] = useState<ProfessionalRevenueReport | null>(null);
  const [totalRevenueReport, setTotalRevenueReport] = useState<TotalRevenueReport | null>(null);

  // Get API URL with fallback
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
    fetchReports();
  }, [startDate, endDate]);

  const fetchReports = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      // Fetch all reports
      const [newClientsRes, professionalRevenueRes, totalRevenueRes] = await Promise.all([
        fetch(`${apiUrl}/api/reports/new-clients?start_date=${startDate}&end_date=${endDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${apiUrl}/api/reports/professional-revenue-summary?start_date=${startDate}&end_date=${endDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${apiUrl}/api/reports/total-revenue?start_date=${startDate}&end_date=${endDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (newClientsRes.ok) {
        const newClientsData = await newClientsRes.json();
        setNewClientsReport(newClientsData);
      }

      if (professionalRevenueRes.ok) {
        const professionalRevenueData = await professionalRevenueRes.json();
        setProfessionalRevenueReport(professionalRevenueData);
      }

      if (totalRevenueRes.ok) {
        const totalRevenueData = await totalRevenueRes.json();
        setTotalRevenueReport(totalRevenueData);
      }

    } catch (error) {
      console.error('Error fetching reports:', error);
      setError('Não foi possível carregar os relatórios');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "dd/MM/yyyy", { locale: ptBR });
  };

  const formatMonth = (monthString: string) => {
    return format(new Date(monthString + '-01'), "MMMM 'de' yyyy", { locale: ptBR });
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <BarChart2 className="h-8 w-8 text-red-600 mr-3" />
          Relatórios Administrativos
        </h1>
        <p className="text-gray-600">Análise completa de faturamento e crescimento</p>
      </div>

      {/* Date Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Calendar className="h-6 w-6 text-red-600 mr-2" />
          <h2 className="text-xl font-semibold">Período de Análise</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={fetchReports}
              className={`btn btn-primary w-full ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? 'Carregando...' : 'Atualizar Relatórios'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('new-clients')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'new-clients'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <UserPlus className="h-5 w-5 inline mr-2" />
              Novos Clientes
            </button>
            <button
              onClick={() => setActiveTab('professional-revenue')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'professional-revenue'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Users className="h-5 w-5 inline mr-2" />
              Faturamento Profissionais
            </button>
            <button
              onClick={() => setActiveTab('total-revenue')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'total-revenue'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <TrendingUp className="h-5 w-5 inline mr-2" />
              Faturamento Total
            </button>
            <button
              onClick={() => setActiveTab('detailed')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'detailed'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BarChart2 className="h-5 w-5 inline mr-2" />
              Relatório Detalhado
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* New Clients Report */}
          {activeTab === 'new-clients' && newClientsReport && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Relatório de Novos Clientes</h3>
                <button className="btn btn-outline flex items-center">
                  <Download className="h-5 w-5 mr-2" />
                  Exportar
                </button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-blue-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-blue-600">Total de Novos Clientes</h4>
                    <UserPlus className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-3xl font-bold text-blue-700">{newClientsReport.total_new_clients}</p>
                  <p className="text-sm text-blue-600 mt-1">Assinaturas no período</p>
                </div>

                <div className="bg-green-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-green-600">Receita de Assinaturas</h4>
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="text-3xl font-bold text-green-700">{formatCurrency(newClientsReport.subscription_revenue)}</p>
                  <p className="text-sm text-green-600 mt-1">Faturamento com novos clientes</p>
                </div>
              </div>

              {/* Monthly Breakdown */}
              {newClientsReport.clients_by_month.length > 0 && (
                <div>
                  <h4 className="text-md font-semibold mb-4">Evolução Mensal</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Mês</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Novos Clientes</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Receita</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newClientsReport.clients_by_month.map((month, index) => (
                          <tr key={index} className="border-b border-gray-100">
                            <td className="py-3 px-4 text-sm text-gray-900">{formatMonth(month.month)}</td>
                            <td className="py-3 px-4 text-sm text-gray-900 text-right font-medium">{month.count}</td>
                            <td className="py-3 px-4 text-sm text-gray-900 text-right font-medium">{formatCurrency(month.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Professional Revenue Report */}
          {activeTab === 'professional-revenue' && professionalRevenueReport && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Faturamento por Profissionais</h3>
                <button className="btn btn-outline flex items-center">
                  <Download className="h-5 w-5 mr-2" />
                  Exportar
                </button>
              </div>

              {/* Summary */}
              <div className="bg-blue-50 p-6 rounded-lg mb-6">
                <h4 className="text-md font-semibold text-blue-900 mb-2">Resumo do Período</h4>
                <p className="text-2xl font-bold text-blue-700">{formatCurrency(professionalRevenueReport.total_revenue)}</p>
                <p className="text-sm text-blue-600">Faturamento total dos profissionais</p>
              </div>

              {/* Professional Breakdown */}
              <div className="mb-6">
                <h4 className="text-md font-semibold mb-4">Faturamento por Profissional</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Profissional</th>
                        <th className="text-center py-3 px-4 font-medium text-gray-700">Porcentagem</th>
                        <th className="text-center py-3 px-4 font-medium text-gray-700">Consultas</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Faturamento</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Valor Profissional</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Valor Convênio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {professionalRevenueReport.revenue_by_professional.map((prof, index) => (
                        <tr key={index} className="border-b border-gray-100">
                          <td className="py-3 px-4 text-sm text-gray-900">{prof.professional_name}</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-center">{prof.professional_percentage}%</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-center">{prof.consultation_count}</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-right font-medium">{formatCurrency(prof.revenue)}</td>
                          <td className="py-3 px-4 text-sm text-blue-600 text-right font-medium">{formatCurrency(prof.professional_payment)}</td>
                          <td className="py-3 px-4 text-sm text-green-600 text-right font-medium">{formatCurrency(prof.clinic_revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Service Breakdown */}
              <div>
                <h4 className="text-md font-semibold mb-4">Faturamento por Serviço</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Serviço</th>
                        <th className="text-center py-3 px-4 font-medium text-gray-700">Consultas</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Faturamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {professionalRevenueReport.revenue_by_service.map((service, index) => (
                        <tr key={index} className="border-b border-gray-100">
                          <td className="py-3 px-4 text-sm text-gray-900">{service.service_name}</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-center">{service.consultation_count}</td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-right font-medium">{formatCurrency(service.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Total Revenue Report */}
          {activeTab === 'total-revenue' && totalRevenueReport && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Faturamento Total do Convênio</h3>
                <button className="btn btn-outline flex items-center">
                  <Download className="h-5 w-5 mr-2" />
                  Exportar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-blue-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-blue-600">Receita de Assinaturas</h4>
                    <UserPlus className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-2xl font-bold text-blue-700">{formatCurrency(totalRevenueReport.subscription_revenue)}</p>
                  <p className="text-sm text-blue-600 mt-1">Novos clientes</p>
                </div>

                <div className="bg-green-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-green-600">Receita de Consultas</h4>
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(totalRevenueReport.consultation_revenue)}</p>
                  <p className="text-sm text-green-600 mt-1">Porcentagem dos profissionais</p>
                </div>

                <div className="bg-purple-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-purple-600">Faturamento Bruto</h4>
                    <TrendingUp className="h-5 w-5 text-purple-600" />
                  </div>
                  <p className="text-2xl font-bold text-purple-700">{formatCurrency(totalRevenueReport.total_revenue)}</p>
                  <p className="text-sm text-purple-600 mt-1">Soma total</p>
                </div>

                <div className="bg-red-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-red-600">Receita Líquida</h4>
                    <DollarSign className="h-5 w-5 text-red-600" />
                  </div>
                  <p className="text-2xl font-bold text-red-700">{formatCurrency(totalRevenueReport.clinic_total_revenue)}</p>
                  <p className="text-sm text-red-600 mt-1">Valor final do convênio</p>
                </div>
              </div>

              <div className="mt-8 p-6 bg-gray-50 rounded-lg">
                <h4 className="text-md font-semibold mb-4">Composição da Receita</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Assinaturas de novos clientes:</span>
                    <span className="font-medium">{formatCurrency(totalRevenueReport.subscription_revenue)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Porcentagem das consultas:</span>
                    <span className="font-medium">{formatCurrency(totalRevenueReport.consultation_revenue)}</span>
                  </div>
                  <div className="border-t border-gray-300 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold text-gray-900">Total do Convênio:</span>
                      <span className="text-lg font-bold text-red-600">{formatCurrency(totalRevenueReport.clinic_total_revenue)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Report (existing functionality) */}
          {activeTab === 'detailed' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Relatório Detalhado por Profissional e Serviço</h3>
                <button className="btn btn-outline flex items-center">
                  <Download className="h-5 w-5 mr-2" />
                  Exportar
                </button>
              </div>
              
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <BarChart2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  Relatório Detalhado
                </h4>
                <p className="text-gray-600">
                  Esta funcionalidade mantém o relatório detalhado existente por profissional e serviço.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhancedReportsPage;