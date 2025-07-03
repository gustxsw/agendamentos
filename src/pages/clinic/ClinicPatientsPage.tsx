import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Users, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle, 
  Building2
} from 'lucide-react';

type Patient = {
  id: number;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  birth_date: string;
  is_convenio_patient: boolean;
  professional_id: number;
  professional_name: string;
};

const ClinicPatientsPage: React.FC = () => {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [professionals, setProfessionals] = useState<{id: number, name: string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'convenio' | 'particular'>('all');
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);

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
    // Apply filters
    let filtered = patients;

    // Filter by type
    if (filterType === 'convenio') {
      filtered = filtered.filter(patient => patient.is_convenio_patient);
    } else if (filterType === 'particular') {
      filtered = filtered.filter(patient => !patient.is_convenio_patient);
    }

    // Filter by professional
    if (selectedProfessionalId) {
      filtered = filtered.filter(patient => patient.professional_id === selectedProfessionalId);
    }

    // Filter by search term
    if (searchTerm.trim() !== '') {
      filtered = filtered.filter(patient =>
        patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.cpf.includes(searchTerm.replace(/\D/g, '')) ||
        patient.phone?.includes(searchTerm.replace(/\D/g, ''))
      );
    }

    setFilteredPatients(filtered);
  }, [searchTerm, patients, filterType, selectedProfessionalId]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      // Fetch professionals
      const professionalsResponse = await fetch(`${apiUrl}/api/clinic/professionals`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (professionalsResponse.ok) {
        const professionalsData = await professionalsResponse.json();
        setProfessionals(professionalsData);
      }

      // Fetch patients
      const patientsResponse = await fetch(`${apiUrl}/api/clinic/patients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (patientsResponse.ok) {
        const patientsData = await patientsResponse.json();
        setPatients(patientsData);
        setFilteredPatients(patientsData);
      } else {
        throw new Error('Erro ao carregar pacientes');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Não foi possível carregar os dados');
    } finally {
      setIsLoading(false);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setSelectedProfessionalId(null);
  };

  const formatCpf = (cpf: string) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando pacientes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Users className="h-8 w-8 text-purple-600 mr-3" />
          Pacientes da Clínica
        </h1>
        <p className="text-gray-600">Visualize todos os pacientes atendidos pelos profissionais da clínica</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Filter className="h-5 w-5 text-purple-600 mr-2" />
          <h2 className="text-lg font-semibold">Filtros</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nome, CPF ou telefone..."
                className="input pl-10"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'convenio' | 'particular')}
              className="input"
            >
              <option value="all">Todos</option>
              <option value="convenio">Convênio</option>
              <option value="particular">Particular</option>
            </select>
          </div>

          {/* Professional Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Profissional
            </label>
            <select
              value={selectedProfessionalId || ''}
              onChange={(e) => setSelectedProfessionalId(e.target.value ? parseInt(e.target.value) : null)}
              className="input"
            >
              <option value="">Todos os profissionais</option>
              {professionals.map(prof => (
                <option key={prof.id} value={prof.id}>{prof.name}</option>
              ))}
            </select>
          </div>

          {/* Clear Filters */}
          <div className="flex items-end">
            <button
              onClick={resetFilters}
              className="btn btn-secondary w-full"
            >
              Limpar Filtros
            </button>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {filteredPatients.length} paciente(s) encontrado(s)
            {searchTerm && ` para "${searchTerm}"`}
            {filterType !== 'all' && ` • Tipo: ${filterType === 'convenio' ? 'Convênio' : 'Particular'}`}
            {selectedProfessionalId && ` • Profissional: ${professionals.find(p => p.id === selectedProfessionalId)?.name}`}
          </div>
        </div>
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

      {/* Patients List */}
      {filteredPatients.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm || filterType !== 'all' || selectedProfessionalId 
              ? 'Nenhum paciente encontrado' 
              : 'Nenhum paciente cadastrado'
            }
          </h3>
          <p className="text-gray-600 mb-4">
            {searchTerm || filterType !== 'all' || selectedProfessionalId
              ? 'Tente ajustar os filtros de busca'
              : 'Ainda não existem pacientes cadastrados na clínica'
            }
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left font-medium text-gray-700">Nome</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-700">CPF</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-700">Contato</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-700">Tipo</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-700">Profissional</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-700">Nascimento</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((patient) => (
                  <tr key={patient.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm text-gray-900">{patient.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{formatCpf(patient.cpf)}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {patient.phone && (
                        <div className="flex items-center">
                          {formatPhone(patient.phone)}
                          <a
                            href={`https://wa.me/55${patient.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-green-600 hover:text-green-800 text-xs"
                          >
                            WhatsApp
                          </a>
                        </div>
                      )}
                      {patient.email && <div className="text-xs text-gray-500 mt-1">{patient.email}</div>}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        patient.is_convenio_patient
                          ? 'bg-green-100 text-green-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {patient.is_convenio_patient ? 'Convênio' : 'Particular'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{patient.professional_name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{formatDate(patient.birth_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicPatientsPage;