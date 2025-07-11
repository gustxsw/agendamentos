import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, Calendar, User, Users, AlertTriangle, Clock, DollarSign, CheckCircle, XCircle, Plus, MapPin } from 'lucide-react';

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

type ParticularPatient = {
  id: number;
  name: string;
  cpf: string;
  phone: string;
  birth_date: string;
  notes: string;
  is_convenio_patient: boolean;
};

type ProfessionalLocation = {
  id: number;
  clinic_name: string;
  address: string;
  city: string;
  state: string;
  is_main: boolean;
};

type SubscriptionStatus = {
  status: string;
  expires_at: string | null;
  days_remaining: number;
  can_use_agenda: boolean;
};

const UnifiedConsultationPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Search state
  const [cpf, setCpf] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    type: 'convenio_client' | 'dependent' | 'particular' | 'not_found';
    data?: ConvenioClient | Dependent | ParticularPatient;
    dependents?: Dependent[];
  } | null>(null);
  
  // Form state
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedDependentId, setSelectedDependentId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  
  // New patient form (for particulares)
  const [showNewPatientForm, setShowNewPatientForm] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState({
    name: '',
    cpf: '',
    phone: '',
    birth_date: '',
    notes: ''
  });
  
  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [filteredServices, setFilteredServices] = useState<Service[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [locations, setLocations] = useState<ProfessionalLocation[]>([]);
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
      
      // Fetch subscription status
      const subscriptionResponse = await fetch(`${apiUrl}/api/agenda/subscription-status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (subscriptionResponse.ok) {
        const subscriptionData = await subscriptionResponse.json();
        setSubscriptionStatus(subscriptionData);
      }
      
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
      
      // Fetch professional locations
      const locationsResponse = await fetch(`${apiUrl}/api/professional-locations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (locationsResponse.ok) {
        const locationsData = await locationsResponse.json();
        setLocations(locationsData);
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
    setShowNewPatientForm(false);
    
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
      
      // 3. Try to find as particular patient (only if has agenda subscription)
      if (subscriptionStatus?.can_use_agenda) {
        const particularResponse = await fetch(`${apiUrl}/api/agenda/patients/lookup/${cleanCpf}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        
        if (particularResponse.ok) {
          const particularData = await particularResponse.json();
          console.log('✅ Found particular patient:', particularData);
          
          setSearchResult({
            type: 'particular',
            data: particularData
          });
          setSelectedPatientId(particularData.id);
          setSelectedDependentId(null);
          return;
        }
      }
      
      // 4. Not found anywhere
      console.log('❌ CPF not found in any database');
      
      if (subscriptionStatus?.can_use_agenda) {
        // Can create new particular patient
        setSearchResult({ type: 'not_found' });
        setShowNewPatientForm(true);
        setNewPatientForm({ ...newPatientForm, cpf: cleanCpf });
      } else {
        setError('CPF não encontrado. Apenas clientes do Convênio Quiro Ferreira podem ser atendidos sem assinatura da agenda.');
      }
      
    } catch (error) {
      console.error('Error searching CPF:', error);
      setError('Erro ao buscar CPF. Tente novamente.');
    } finally {
      setIsSearching(false);
    }
  };
  
  const createNewParticularPatient = async () => {
    if (!newPatientForm.name || !newPatientForm.cpf) {
      setError('Nome e CPF são obrigatórios para cadastrar novo paciente');
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      const response = await fetch(`${apiUrl}/api/agenda/patients`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...newPatientForm,
          cpf: newPatientForm.cpf.replace(/\D/g, ''),
          phone: newPatientForm.phone.replace(/\D/g, '')
        })
      });
      
      if (response.ok) {
        const newPatient = await response.json();
        console.log('✅ New particular patient created:', newPatient);
        
        setSearchResult({
          type: 'particular',
          data: newPatient
        });
        setSelectedPatientId(newPatient.id);
        setSelectedDependentId(null);
        setShowNewPatientForm(false);
        setSuccess('Paciente particular cadastrado com sucesso!');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao cadastrar paciente');
      }
    } catch (error) {
      console.error('Error creating patient:', error);
      setError('Erro ao cadastrar paciente');
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
      
      let endpoint = '';
      let requestBody: any = {
        professional_id: user?.id,
        service_id: serviceId,
        value: Number(value),
        date: dateTime.toISOString(),
        notes: notes
      };
      
      if (searchResult.type === 'convenio_client' || searchResult.type === 'dependent') {
        // Register consultation for convenio
        endpoint = `${apiUrl}/api/consultations`;
        requestBody.client_id = selectedDependentId ? null : selectedPatientId;
        requestBody.dependent_id = selectedDependentId;
        requestBody.location_id = selectedLocation;
        requestBody.location_id = selectedLocation;
      } else if (searchResult.type === 'particular') {
        // Create appointment for particular patient
        endpoint = `${apiUrl}/api/agenda/appointments`;
        requestBody.patient_id = selectedPatientId;
        requestBody.location_id = selectedLocation;
        requestBody.location_id = selectedLocation;
        requestBody.status = 'completed'; // Mark as completed since it's a consultation
      }
      
      console.log('📝 Submitting:', { endpoint, requestBody });
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao registrar consulta/agendamento');
      }
      
      const result = await response.json();
      console.log('✅ Success:', result);
      
      // Reset form
      resetForm();
      
      setSuccess(
        searchResult.type === 'particular' 
          ? 'Agendamento registrado com sucesso!' 
          : 'Consulta registrada com sucesso!'
      );
      
      // Redirect after delay
      setTimeout(() => {
        navigate('/professional');
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
    setCategoryId('');
    setServiceId(null);
    setSelectedLocation(null);
    setValue('');
    setDate('');
    setTime('');
    setNotes('');
    setShowNewPatientForm(false);
    setNewPatientForm({
      name: '',
      cpf: '',
      phone: '',
      birth_date: '',
      notes: ''
    });
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
      case 'particular':
        const particular = searchResult.data as ParticularPatient;
        return {
          name: particular.name,
          type: 'Paciente Particular',
          status: 'particular',
          color: 'text-blue-700 bg-blue-50'
        };
      default:
        return null;
    }
  };
  
  const patientInfo = getPatientDisplayInfo();
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Registrar Consulta / Agendamento</h1>
        <p className="text-gray-600">
          {subscriptionStatus?.can_use_agenda 
            ? 'Busque por CPF para atender clientes do convênio ou pacientes particulares'
            : 'Registre consultas para clientes do Convênio Quiro Ferreira'
          }
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
            <Search className="h-5 w-5 mr-2 text-red-600" />
            Buscar Paciente por CPF
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
                {searchResult?.type === 'particular' ? (
                  <User className="h-5 w-5 mr-2" />
                ) : (
                  <Users className="h-5 w-5 mr-2" />
                )}
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
        
        {/* New Patient Form */}
        {showNewPatientForm && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Plus className="h-5 w-5 mr-2 text-blue-600" />
              Cadastrar Novo Paciente Particular
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={newPatientForm.name}
                  onChange={(e) => setNewPatientForm({...newPatientForm, name: e.target.value})}
                  className="input"
                  placeholder="Nome do paciente"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={newPatientForm.phone}
                  onChange={(e) => setNewPatientForm({...newPatientForm, phone: e.target.value})}
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
                  value={newPatientForm.birth_date}
                  onChange={(e) => setNewPatientForm({...newPatientForm, birth_date: e.target.value})}
                  className="input"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  value={newPatientForm.notes}
                  onChange={(e) => setNewPatientForm({...newPatientForm, notes: e.target.value})}
                  className="input"
                  placeholder="Observações sobre o paciente"
                />
              </div>
            </div>
            
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={createNewParticularPatient}
                className="btn btn-primary"
                disabled={!newPatientForm.name}
              >
                Cadastrar Paciente
              </button>
            </div>
          </div>
        )}
        
        {/* Consultation/Appointment Form */}
        {searchResult && !showNewPatientForm && (
          <form onSubmit={handleSubmit}>
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-red-600" />
              Detalhes da {searchResult.type === 'particular' ? 'Consulta/Agendamento' : 'Consulta'}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                {searchResult.type !== 'particular' && serviceId && (
                  <p className="text-xs text-gray-500 mt-1">
                    Valor será calculado automaticamente com a porcentagem do profissional
                  </p>
                )}
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
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Local de Atendimento
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <select
                    value={selectedLocation || ''}
                    onChange={(e) => setSelectedLocation(e.target.value ? Number(e.target.value) : null)}
                    className="input pl-10"
                    disabled={isLoading}
                  >
                    <option value="">Selecione um local (opcional)</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.clinic_name} - {location.city}/{location.state}
                      </option>
                    ))}
                  </select>
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
                  placeholder="Observações sobre a consulta/agendamento..."
                  disabled={isLoading}
                />
              </div>
            </div>
            
            <div className="flex justify-end mt-8 space-x-3">
              <button
                type="button"
                onClick={() => navigate('/professional')}
                className="btn btn-secondary"
                disabled={isLoading}
              >
                Cancelar
              </button>
              
              <button
                type="submit"
                className={`btn btn-primary ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                disabled={isLoading || !searchResult}
              >
                {isLoading ? 'Processando...' : 
                 searchResult?.type === 'particular' ? 'Registrar Agendamento' : 'Registrar Consulta'}
              </button>
            </div>
          </form>
        )}
        
        {/* Info about agenda subscription */}
        {!subscriptionStatus?.can_use_agenda && (
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
              <div>
                <p className="text-yellow-800 font-medium">Funcionalidade Limitada</p>
                <p className="text-yellow-700 text-sm">
                  Sem assinatura da agenda, você pode apenas registrar consultas para clientes do Convênio Quiro Ferreira. 
                  Para atender pacientes particulares e usar a agenda completa, assine o plano mensal.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UnifiedConsultationPage;