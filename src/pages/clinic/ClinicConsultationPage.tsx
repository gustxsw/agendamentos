import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Calendar, 
  User, 
  Users, 
  AlertTriangle, 
  Clock, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  Plus,
  Briefcase
} from 'lucide-react';

type Service = {
  id: number;
  name: string;
  base_price: number;
  category_id: number;
  category_name: string;
  is_base_service: boolean;
};

type Category = {
  id: number;
  name: string;
  description: string;
};

type ConvenioClient = {
  id: number;
  name: string;
  cpf: string;
  subscription_status: string;
  subscription_expiry: string;
};

type Dependent = {
  id: number;
  name: string;
  cpf: string;
  birth_date: string;
  client_id: number;
  client_name: string;
  client_subscription_status: string;
};

type ClinicProfessional = {
  id: number;
  name: string;
  professional_type: string;
};

const ClinicConsultationPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Search state
  const [cpf, setCpf] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    type: 'convenio_client' | 'dependent' | 'not_found';
    data?: ConvenioClient | Dependent;
    dependents?: Dependent[];
  } | null>(null);
  
  // Form state
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedDependentId, setSelectedDependentId] = useState<number | null>(null);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  
  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [filteredServices, setFilteredServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<ClinicProfessional[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
  
  useEffect(() => {
    fetchInitialData();
  }, []);
  
  useEffect(() => {
    if (categoryId) {
      const filtered = services.filter(service => service.category_id === parseInt(categoryId));
      setFilteredServices(filtered);
      setServiceId(null);
      setValue('');
    } else {
      setFilteredServices([]);
      setServiceId(null);
      setValue('');
    }
  }, [categoryId, services]);
  
  const fetchInitialData = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      // Fetch categories
      const categoriesResponse = await fetch(`${apiUrl}/api/service-categories`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json();
        setCategories(categoriesData);
      }
      
      // Fetch services
      const servicesResponse = await fetch(`${apiUrl}/api/services`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (servicesResponse.ok) {
        const servicesData = await servicesResponse.json();
        setServices(servicesData);
      }
      
      // Fetch clinic professionals
      const professionalsResponse = await fetch(`${apiUrl}/api/clinic/professionals`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (professionalsResponse.ok) {
        const professionalsData = await professionalsResponse.json();
        // Filter only active professionals that can do convenio consultations
        const convenioProfs = professionalsData.filter(p => 
          p.is_active && (p.professional_type === 'convenio' || p.professional_type === 'both')
        );
        setProfessionals(convenioProfs);
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setError('Não foi possível carregar os dados necessários');
    }
  };
  
  const searchByCpf = async () => {
    setError('');
    setSuccess('');
    setSearchResult(null);
    
    if (!/^\d{11}$/.test(cpf.replace(/\D/g, ''))) {
      setError('CPF deve conter 11 dígitos numéricos');
      return;
    }
    
    try {
      setIsSearching(true);
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      const cleanCpf = cpf.replace(/\D/g, '');
      
      console.log('🔍 Searching for CPF:', cleanCpf);
      
      // 1. First, try to find a dependent with this CPF
      const dependentResponse = await fetch(`${apiUrl}/api/dependents/lookup/${cleanCpf}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (dependentResponse.ok) {
        const dependentData = await dependentResponse.json();
        console.log('✅ Found dependent:', dependentData);
        
        if (dependentData.client_subscription_status !== 'active') {
          setError('Este dependente não pode ser atendido pois o titular não possui assinatura ativa.');
          return;
        }
        
        setSearchResult({
          type: 'dependent',
          data: dependentData
        });
        setSelectedDependentId(dependentData.id);
        setSelectedPatientId(dependentData.client_id);
        return;
      }
      
      // 2. Try to find as convenio client
      const clientResponse = await fetch(`${apiUrl}/api/clients/lookup/${cleanCpf}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (clientResponse.ok) {
        const clientData = await clientResponse.json();
        console.log('✅ Found convenio client:', clientData);
        
        if (clientData.subscription_status !== 'active') {
          setError('Este cliente não pode ser atendido pois não possui assinatura ativa.');
          return;
        }
        
        // Fetch dependents
        const dependentsResponse = await fetch(`${apiUrl}/api/dependents/${clientData.id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        
        let dependents = [];
        if (dependentsResponse.ok) {
          dependents = await dependentsResponse.json();
        }
        
        setSearchResult({
          type: 'convenio_client',
          data: clientData,
          dependents: dependents
        });
        setSelectedPatientId(clientData.id);
        setSelectedDependentId(null);
        return;
      }
      
      // 3. Not found anywhere
      console.log('❌ CPF not found in any database');
      setSearchResult({ type: 'not_found' });
      setError('CPF não encontrado. Apenas clientes do Convênio Quiro Ferreira podem ser atendidos.');
      
    } catch (error) {
      console.error('Error searching CPF:', error);
      setError('Erro ao buscar CPF. Tente novamente.');
    } finally {
      setIsSearching(false);
    }
  };
  
  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = Number(e.target.value);
    setServiceId(selectedId);
    
    const selectedService = services.find(service => service.id === selectedId);
    if (selectedService) {
      setValue(selectedService.base_price.toString());
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!searchResult) {
      setError('É necessário buscar um paciente primeiro');
      return;
    }
    
    if (!selectedProfessionalId) {
      setError('É necessário selecionar um profissional');
      return;
    }
    
    if (!serviceId || !value || !date || !time) {
      setError('Todos os campos são obrigatórios');
      return;
    }
    
    if (Number(value) <= 0) {
      setError('O valor deve ser maior que zero');
      return;
    }
    
    try {
      setIsLoading(true);
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      // Combine date and time
      const dateTime = new Date(`${date}T${time}`);
      
      const requestBody = {
        client_id: selectedDependentId ? null : selectedPatientId,
        dependent_id: selectedDependentId,
        professional_id: selectedProfessionalId,
        service_id: serviceId,
        value: Number(value),
        date: dateTime.toISOString(),
        notes: notes
      };
      
      console.log('📝 Submitting clinic consultation:', requestBody);
      
      const response = await fetch(`${apiUrl}/api/clinic/consultations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao registrar consulta');
      }
      
      const result = await response.json();
      console.log('✅ Success:', result);
      
      // Reset form
      resetForm();
      
      setSuccess('Consulta registrada com sucesso!');
      
      // Redirect after delay
      setTimeout(() => {
        navigate('/clinic');
      }, 2000);
      
    } catch (error) {
      console.error('Error submitting:', error);
      setError(error instanceof Error ? error.message : 'Erro ao processar solicitação');
    } finally {
      setIsLoading(false);
    }
  };
  
  const resetForm = () => {
    setCpf('');
    setSearchResult(null);
    setSelectedPatientId(null);
    setSelectedDependentId(null);
    setSelectedProfessionalId(null);
    setCategoryId('');
    setServiceId(null);
    setValue('');
    setDate('');
    setTime('');
    setNotes('');
  };
  
  const formatCpf = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    const limitedValue = numericValue.slice(0, 11);
    setCpf(limitedValue);
  };
  
  const formattedCpf = cpf
    ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : '';
  
  const getPatientDisplayInfo = () => {
    if (!searchResult) return null;
    
    switch (searchResult.type) {
      case 'convenio_client':
        const client = searchResult.data as ConvenioClient;
        return {
          name: selectedDependentId 
            ? searchResult.dependents?.find(d => d.id === selectedDependentId)?.name || ''
            : client.name,
          type: selectedDependentId ? 'Dependente do Convênio' : 'Titular do Convênio',
          status: client.subscription_status,
          color: 'text-green-700 bg-green-50'
        };
      case 'dependent':
        const dependent = searchResult.data as Dependent;
        return {
          name: dependent.name,
          type: 'Dependente do Convênio',
          status: dependent.client_subscription_status,
          color: 'text-green-700 bg-green-50'
        };
      default:
        return null;
    }
  };
  
  const patientInfo = getPatientDisplayInfo();
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Registrar Consulta</h1>
        <p className="text-gray-600">
          Registre consultas para clientes do Convênio Quiro Ferreira
        </p>
      </div>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 flex items-center">
          <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 text-green-600 p-4 rounded-lg mb-6 flex items-center">
          <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" />
          {success}
        </div>
      )}
      
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {/* CPF Search Section */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Search className="h-5 w-5 mr-2 text-purple-600" />
            Buscar Cliente por CPF
          </h2>
          
          <div className="flex items-center space-x-3">
            <div className="flex-1">
              <input
                type="text"
                value={formattedCpf}
                onChange={(e) => formatCpf(e.target.value)}
                placeholder="000.000.000-00"
                className="input"
                disabled={isSearching || isLoading}
              />
            </div>
            
            <button
              type="button"
              onClick={searchByCpf}
              className={`btn btn-primary ${isSearching ? 'opacity-70 cursor-not-allowed' : ''}`}
              disabled={isSearching || isLoading || !cpf}
            >
              {isSearching ? 'Buscando...' : 'Buscar'}
            </button>
            
            {searchResult && (
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-secondary"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        
        {/* Patient Info Display */}
        {patientInfo && (
          <div className={`p-4 rounded-lg mb-6 ${patientInfo.color}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Users className="h-5 w-5 mr-2" />
                <div>
                  <p className="font-medium">{patientInfo.name}</p>
                  <p className="text-sm">{patientInfo.type}</p>
                </div>
              </div>
              
              {/* Dependent Selection for Convenio Clients */}
              {searchResult?.type === 'convenio_client' && searchResult.dependents && searchResult.dependents.length > 0 && (
                <div className="ml-4">
                  <select
                    value={selectedDependentId || ''}
                    onChange={(e) => setSelectedDependentId(e.target.value ? Number(e.target.value) : null)}
                    className="input w-auto min-w-[200px]"
                  >
                    <option value="">Consulta para o titular</option>
                    {searchResult.dependents.map((dependent) => (
                      <option key={dependent.id} value={dependent.id}>
                        {dependent.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Consultation Form */}
        {searchResult && searchResult.type !== 'not_found' && (
          <form onSubmit={handleSubmit}>
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-purple-600" />
              Detalhes da Consulta
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Profissional *
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <select
                    value={selectedProfessionalId || ''}
                    onChange={(e) => setSelectedProfessionalId(e.target.value ? Number(e.target.value) : null)}
                    className="input pl-10"
                    disabled={isLoading}
                    required
                  >
                    <option value="">Selecione um profissional</option>
                    {professionals.map((professional) => (
                      <option key={professional.id} value={professional.id}>
                        {professional.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Categoria do Serviço *
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="input"
                  disabled={isLoading}
                  required
                >
                  <option value="">Selecione uma categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serviço *
                </label>
                <select
                  value={serviceId || ''}
                  onChange={handleServiceChange}
                  className="input"
                  disabled={isLoading || !categoryId}
                  required
                >
                  <option value="">Selecione um serviço</option>
                  {filteredServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(service.base_price)}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Valor (R$) *
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="input pl-10"
                    disabled={isLoading}
                    required
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Valor será calculado automaticamente com a porcentagem do profissional
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input"
                  disabled={isLoading}
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hora *
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="input pl-10"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input min-h-[80px]"
                  placeholder="Observações sobre a consulta..."
                  disabled={isLoading}
                />
              </div>
            </div>
            
            <div className="flex justify-end mt-8 space-x-3">
              <button
                type="button"
                onClick={() => navigate('/clinic')}
                className="btn btn-secondary"
                disabled={isLoading}
              >
                Cancelar
              </button>
              
              <button
                type="submit"
                className={`btn btn-primary ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                disabled={isLoading || !searchResult || !selectedProfessionalId}
              >
                {isLoading ? 'Processando...' : 'Registrar Consulta'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ClinicConsultationPage;