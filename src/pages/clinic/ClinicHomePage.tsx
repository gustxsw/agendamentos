import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { 
  Building2, 
  Users, 
  Calendar, 
  BarChart2, 
  TrendingUp, 
  DollarSign,
  UserPlus,
  CalendarPlus,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

type ClinicStats = {
  total_professionals: number;
  active_professionals: number;
  total_consultations: number;
  monthly_revenue: number;
  pending_payments: number;
};

const ClinicHomePage: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<ClinicStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const getApiUrl = () => {
    if (
      window.location.hostname === "cartaoquiroferreira.com.br" ||
      window.location.hostname === "www.cartaoquiroferreira.com.br"
    ) {
      return "https://www.cartaoquiroferreira.com.br";
    }
    return "http://localhost:3001";
  };

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      // Fetch clinic statistics
      const response = await fetch(`${apiUrl}/api/clinic/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      } else {
        throw new Error('Erro ao carregar estatísticas');
      }
    } catch (error) {
      console.error('Error fetching clinic stats:', error);
      setError('Não foi possível carregar as estatísticas da clínica');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRetry = () => {
    fetchStats();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
            <Building2 className="h-8 w-8 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Olá, {user?.name}</h1>
            <p className="text-gray-600">Bem-vindo ao painel da clínica.</p>
          </div>
        </div>
        
        <div className="flex space-x-3">
          {error && (
            <button
              onClick={handleRetry}
              className="btn btn-outline flex items-center"
              disabled={isLoading}
            >
              <RefreshCw className={`h-5 w-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Tentar Novamente
            </button>
          )}
          
          <Link to="/clinic/register-consultation" className="btn btn-primary flex items-center">
            <CalendarPlus className="h-5 w-5 mr-2" />
            Nova Consulta
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-600 p-4 mb-6">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <div>
              <p className="text-red-700 font-medium">Erro ao carregar dados</p>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando dados da clínica...</p>
        </div>
      ) : stats ? (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Profissionais Ativos</h3>
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.active_professionals}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                de {stats.total_professionals} cadastrados
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Consultas do Mês</h3>
                <Calendar className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.total_consultations}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Atendimentos realizados
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Faturamento Mensal</h3>
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(stats.monthly_revenue)}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Receita bruta do mês
              </p>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">Pagamentos Pendentes</h3>
                <DollarSign className="h-5 w-5 text-orange-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(stats.pending_payments)}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Valores a receber
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <Link
              to="/clinic/professionals"
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-center mb-4">
                <div className="bg-blue-50 p-3 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900">Gerenciar Profissionais</h3>
                  <p className="text-sm text-gray-600">Cadastrar e gerenciar profissionais</p>
                </div>
              </div>
            </Link>

            <Link
              to="/clinic/agenda"
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-center mb-4">
                <div className="bg-green-50 p-3 rounded-lg group-hover:bg-green-100 transition-colors">
                  <Calendar className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900">Agenda da Clínica</h3>
                  <p className="text-sm text-gray-600">Visualizar agenda por profissional</p>
                </div>
              </div>
            </Link>

            <Link
              to="/clinic/reports"
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-center mb-4">
                <div className="bg-purple-50 p-3 rounded-lg group-hover:bg-purple-100 transition-colors">
                  <BarChart2 className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900">Relatórios</h3>
                  <p className="text-sm text-gray-600">Relatórios por profissional</p>
                </div>
              </div>
            </Link>
          </div>
        </>
      ) : (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <AlertCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Dados não disponíveis
          </h3>
          <p className="text-gray-600 mb-4">
            Não foi possível carregar os dados da clínica.
          </p>
          <button 
            onClick={handleRetry} 
            className="btn btn-primary"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                Carregando...
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 mr-2" />
                Tentar Novamente
              </>
            )}
          </button>
        </div>
      )}

      {/* Information Card */}
      <div className="bg-purple-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-purple-900 mb-3 flex items-center">
          <Building2 className="h-5 w-5 mr-2" />
          Gestão de Clínica
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex items-center">
            <UserPlus className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Profissionais:</strong> Cadastre e gerencie sua equipe
            </span>
          </div>
          <div className="flex items-center">
            <Calendar className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Agenda:</strong> Visualize agendamentos por profissional
            </span>
          </div>
          <div className="flex items-center">
            <BarChart2 className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Relatórios:</strong> Acompanhe performance individual
            </span>
          </div>
          <div className="flex items-center">
            <DollarSign className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Financeiro:</strong> Controle de receitas e repasses
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClinicHomePage;