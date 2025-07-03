import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Users, 
  UserPlus, 
  Edit, 
  Eye, 
  EyeOff, 
  X, 
  Check,
  AlertCircle,
  Briefcase,
  Calendar,
  Building2
} from 'lucide-react';

type Professional = {
  id: number;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  professional_registration: string;
  photo_url: string;
  professional_type: string;
  percentage: number;
  is_active: boolean;
  category_name: string;
};

const ClinicProfessionalsPage: React.FC = () => {
  const { user } = useAuth();
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    email: '',
    phone: '',
    password: '',
    professional_registration: '',
    category_id: '',
    percentage: '50',
    professional_type: 'convenio' // 'convenio', 'agenda', 'both'
  });
  
  // Password visibility
  const [showPassword, setShowPassword] = useState(false);

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

  const fetchProfessionals = async () => {
    try {
      setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddProfessional = async () => {
    try {
      setError('');
      
      // Validate form
      if (!formData.name || !formData.cpf || !formData.password) {
        setError('Nome, CPF e senha são obrigatórios');
        return;
      }
      
      if (formData.cpf.length !== 11) {
        setError('CPF deve conter 11 dígitos');
        return;
      }
      
      if (formData.password.length < 6) {
        setError('Senha deve ter pelo menos 6 caracteres');
        return;
      }
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/professionals`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSuccess('Profissional cadastrado com sucesso!');
        setShowAddModal(false);
        resetForm();
        fetchProfessionals();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao cadastrar profissional');
      }
    } catch (error) {
      console.error('Error adding professional:', error);
      setError(error instanceof Error ? error.message : 'Erro ao cadastrar profissional');
    }
  };

  const handleUpdateProfessional = async () => {
    if (!selectedProfessional) return;
    
    try {
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/professionals/${selectedProfessional.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          percentage: parseFloat(formData.percentage),
          is_active: selectedProfessional.is_active
        })
      });

      if (response.ok) {
        setSuccess('Profissional atualizado com sucesso!');
        setShowEditModal(false);
        fetchProfessionals();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao atualizar profissional');
      }
    } catch (error) {
      console.error('Error updating professional:', error);
      setError(error instanceof Error ? error.message : 'Erro ao atualizar profissional');
    }
  };

  const toggleProfessionalStatus = async (professional: Professional) => {
    try {
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/professionals/${professional.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          percentage: professional.percentage,
          is_active: !professional.is_active
        })
      });

      if (response.ok) {
        setSuccess(`Profissional ${professional.is_active ? 'desativado' : 'ativado'} com sucesso!`);
        fetchProfessionals();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao atualizar status do profissional');
      }
    } catch (error) {
      console.error('Error toggling professional status:', error);
      setError(error instanceof Error ? error.message : 'Erro ao atualizar status do profissional');
    }
  };

  const openEditModal = (professional: Professional) => {
    setSelectedProfessional(professional);
    setFormData({
      ...formData,
      percentage: professional.percentage.toString()
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      cpf: '',
      email: '',
      phone: '',
      password: '',
      professional_registration: '',
      category_id: '',
      percentage: '50',
      professional_type: 'convenio'
    });
    setShowPassword(false);
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

  const getProfessionalTypeLabel = (type: string) => {
    switch (type) {
      case 'convenio': return 'Convênio';
      case 'agenda': return 'Agenda';
      case 'both': return 'Convênio e Agenda';
      default: return type;
    }
  };

  const getProfessionalTypeColor = (type: string) => {
    switch (type) {
      case 'convenio': return 'bg-green-100 text-green-800';
      case 'agenda': return 'bg-blue-100 text-blue-800';
      case 'both': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getProfessionalTypeIcon = (type: string) => {
    switch (type) {
      case 'convenio': return <Users className="h-4 w-4 mr-1" />;
      case 'agenda': return <Calendar className="h-4 w-4 mr-1" />;
      case 'both': return <Briefcase className="h-4 w-4 mr-1" />;
      default: return null;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando profissionais...</p>
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
            <Users className="h-8 w-8 text-purple-600 mr-3" />
            Profissionais da Clínica
          </h1>
          <p className="text-gray-600">Gerencie os profissionais vinculados à sua clínica</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary flex items-center"
        >
          <UserPlus className="h-5 w-5 mr-2" />
          Adicionar Profissional
        </button>
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
            <Check className="h-5 w-5 text-green-600 mr-2" />
            <p className="text-green-700">{success}</p>
          </div>
        </div>
      )}

      {/* Professionals List */}
      {professionals.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Nenhum profissional cadastrado
          </h3>
          <p className="text-gray-600 mb-4">
            Comece adicionando profissionais à sua clínica
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary inline-flex items-center"
          >
            <UserPlus className="h-5 w-5 mr-2" />
            Adicionar Primeiro Profissional
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {professionals.map((professional) => (
            <div 
              key={professional.id} 
              className={`bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow ${
                !professional.is_active ? 'border-gray-300 bg-gray-50' : 'border-gray-100'
              }`}
            >
              {/* Professional Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className={`text-lg font-semibold ${!professional.is_active ? 'text-gray-600' : 'text-gray-900'}`}>
                    {professional.name}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`inline-flex items-center text-xs px-2 py-1 rounded-full ${getProfessionalTypeColor(professional.professional_type)}`}>
                      {getProfessionalTypeIcon(professional.professional_type)}
                      {getProfessionalTypeLabel(professional.professional_type)}
                    </span>
                    {!professional.is_active && (
                      <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                        Inativo
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openEditModal(professional)}
                    className="text-blue-600 hover:text-blue-800"
                    title="Editar"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => toggleProfessionalStatus(professional)}
                    className={professional.is_active ? "text-red-600 hover:text-red-800" : "text-green-600 hover:text-green-800"}
                    title={professional.is_active ? "Desativar" : "Ativar"}
                  >
                    {professional.is_active ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Professional Info */}
              <div className="space-y-2 mb-4">
                {professional.category_name && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Especialidade:</span> {professional.category_name}
                  </div>
                )}
                {professional.professional_registration && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Registro:</span> {professional.professional_registration}
                  </div>
                )}
                {professional.email && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Email:</span> {professional.email}
                  </div>
                )}
                {professional.phone && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Telefone:</span> {formatPhone(professional.phone)}
                  </div>
                )}
              </div>

              {/* Percentage */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Porcentagem:</span>
                  <span className="text-sm font-bold text-purple-700">{professional.percentage}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                  <div 
                    className="bg-purple-600 h-2.5 rounded-full" 
                    style={{ width: `${professional.percentage}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Professional Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Adicionar Novo Profissional</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CPF *
                  </label>
                  <input
                    type="text"
                    value={formData.cpf}
                    onChange={(e) => setFormData({...formData, cpf: e.target.value.replace(/\D/g, '')})}
                    className="input"
                    placeholder="Apenas números"
                    maxLength={11}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value.replace(/\D/g, '')})}
                    className="input"
                    placeholder="Apenas números"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Registro Profissional
                  </label>
                  <input
                    type="text"
                    value={formData.professional_registration}
                    onChange={(e) => setFormData({...formData, professional_registration: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoria/Especialidade
                  </label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                    className="input"
                  >
                    <option value="">Selecione uma categoria</option>
                    <option value="1">Fisioterapia</option>
                    <option value="2">Quiropraxia</option>
                    <option value="3">Massoterapia</option>
                    <option value="4">Acupuntura</option>
                    <option value="5">Pilates</option>
                    <option value="6">Psicologia</option>
                    <option value="7">Nutrição</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Porcentagem (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.percentage}
                    onChange={(e) => setFormData({...formData, percentage: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Profissional
                  </label>
                  <select
                    value={formData.professional_type}
                    onChange={(e) => setFormData({...formData, professional_type: e.target.value})}
                    className="input"
                  >
                    <option value="convenio">Convênio</option>
                    <option value="agenda">Agenda</option>
                    <option value="both">Convênio e Agenda</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="input pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddProfessional}
                  className="btn btn-primary"
                >
                  Adicionar Profissional
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Professional Modal */}
      {showEditModal && selectedProfessional && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Editar Profissional</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Profissional:</strong> {selectedProfessional.name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>CPF:</strong> {formatCpf(selectedProfessional.cpf)}
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Porcentagem (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={formData.percentage}
                  onChange={(e) => setFormData({...formData, percentage: e.target.value})}
                  className="input"
                />
              </div>

              <div className="mb-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedProfessional.is_active}
                    onChange={() => setSelectedProfessional({
                      ...selectedProfessional,
                      is_active: !selectedProfessional.is_active
                    })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                  />
                  <span className="ml-2 text-sm text-gray-600">
                    Profissional ativo
                  </span>
                </label>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateProfessional}
                  className="btn btn-primary"
                >
                  Salvar Alterações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicProfessionalsPage;