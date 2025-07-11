import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, User, Search, Filter, Plus, Download, Calendar, Edit, Trash2, X, Check, Upload, FileSignature as Signature } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type Patient = {
  id: number;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  birth_date: string;
  is_convenio_patient: boolean;
};

type DocumentTemplate = {
  id: string;
  name: string;
  type: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type GeneratedDocument = {
  id: string;
  patient_id: number;
  professional_id: number;
  type: string;
  url: string;
  created_at: string;
  template_name: string;
  patient_name: string;
};

const DocumentsPage: React.FC = () => {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Search and filter
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  
  // Form state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  
  // Signature state
  const [signatureUrl, setSignatureUrl] = useState<string>('');
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);

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
    fetchPatients();
    fetchTemplates();
    fetchProfessionalData();
  }, []);

  useEffect(() => {
    if (selectedPatient) {
      fetchPatientDocuments(selectedPatient.id);
    }
  }, [selectedPatient]);

  useEffect(() => {
    // Filter patients based on search term
    if (searchTerm.trim() === '') {
      setFilteredPatients(patients);
    } else {
      const filtered = patients.filter(patient =>
        patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.cpf.includes(searchTerm.replace(/\D/g, ''))
      );
      setFilteredPatients(filtered);
    }
  }, [searchTerm, patients]);

  const fetchPatients = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setPatients(data);
        setFilteredPatients(data);
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
      setError('Erro ao carregar pacientes');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/document-templates`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
      setError('Erro ao carregar templates de documentos');
    }
  };

  const fetchProfessionalData = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/users/${user?.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.signature_url) {
          setSignatureUrl(data.signature_url);
        }
      }
    } catch (error) {
      console.error('Error fetching professional data:', error);
    }
  };

  const fetchPatientDocuments = async (patientId: number) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/generated-documents/patient/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      }
    } catch (error) {
      console.error('Error fetching patient documents:', error);
      setError('Erro ao carregar documentos do paciente');
    }
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = e.target.value;
    setSelectedTemplateId(templateId);
    
    // Reset form data when template changes
    setFormData({});
  };

  const handleCreateDocument = async () => {
    if (!selectedPatient || !selectedTemplateId) {
      setError('Selecione um paciente e um template');
      return;
    }

    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/generate-document`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          patient_id: selectedPatient.id,
          professional_id: user?.id,
          ...formData
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSuccess('Documento gerado com sucesso!');
        setShowCreateModal(false);
        
        // Open the document in a new tab
        window.open(data.url, '_blank');
        
        // Refresh documents list
        fetchPatientDocuments(selectedPatient.id);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao gerar documento');
      }
    } catch (error) {
      console.error('Error creating document:', error);
      setError('Erro ao gerar documento');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignatureUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Por favor, selecione apenas arquivos de imagem');
      return;
    }

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('A imagem deve ter no máximo 2MB');
      return;
    }

    try {
      setIsUploadingSignature(true);
      setError('');
      setSuccess('');

      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${apiUrl}/api/upload-image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao fazer upload da imagem');
      }

      const data = await response.json();
      
      // Save signature URL to user profile
      const saveResponse = await fetch(`${apiUrl}/api/professional/signature`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          signature_url: data.imageUrl
        })
      });

      if (!saveResponse.ok) {
        throw new Error('Falha ao salvar assinatura');
      }

      setSignatureUrl(data.imageUrl);
      setSuccess('Assinatura atualizada com sucesso!');

      // Close modal after short delay
      setTimeout(() => {
        setShowSignatureModal(false);
      }, 1500);

    } catch (error) {
      console.error('Error uploading signature:', error);
      setError(error instanceof Error ? error.message : 'Erro ao fazer upload da assinatura');
    } finally {
      setIsUploadingSignature(false);
    }
  };

  const formatCpf = (cpf: string) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch (error) {
      return dateString;
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    switch (type) {
      case 'atestado': return 'Atestado Médico';
      case 'receituario': return 'Receituário';
      case 'termo_consentimento': return 'Termo de Consentimento';
      case 'lgpd': return 'Termo LGPD';
      case 'solicitacao_exames': return 'Solicitação de Exames';
      case 'declaracao_comparecimento': return 'Declaração de Comparecimento';
      default: return type;
    }
  };

  const getFilteredTemplates = () => {
    if (filterType === 'all') {
      return templates;
    }
    return templates.filter(template => template.type === filterType);
  };

  const getTemplateFields = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return [];

    // Extract fields from template content using regex
    const regex = /{{([^{}]+)}}/g;
    const content = template.content;
    const matches = [...content.matchAll(regex)];
    
    // Extract unique field names
    const fields = [...new Set(matches.map(match => match[1]))];
    
    // Filter out standard fields that are automatically provided
    return fields.filter(field => 
      !['nome', 'cpf', 'email', 'telefone', 'endereco', 'numero', 'complemento', 
       'bairro', 'cidade', 'estado', 'data_atual', 'hora_atual', 
       'profissional_nome', 'profissional_registro', 'profissional_assinatura'].includes(field)
    );
  };

  if (isLoading && patients.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando...</p>
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
            <FileText className="h-8 w-8 text-red-600 mr-3" />
            Documentos
          </h1>
          <p className="text-gray-600">Gere documentos personalizados para seus pacientes</p>
        </div>

        {!signatureUrl && (
          <button
            onClick={() => setShowSignatureModal(true)}
            className="btn btn-primary flex items-center"
          >
            <Signature className="h-5 w-5 mr-2" />
            Cadastrar Assinatura
          </button>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <div className="flex items-center">
            <X className="h-5 w-5 text-red-600 mr-2" />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-4">Pacientes</h2>
            
            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar paciente..."
                  className="input pl-10"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredPatients.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => handlePatientSelect(patient)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedPatient?.id === patient.id
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center">
                    <User className="h-5 w-5 mr-3 text-gray-500" />
                    <div className="flex-1">
                      <p className="font-medium">{patient.name}</p>
                      <p className="text-sm text-gray-500">CPF: {formatCpf(patient.cpf)}</p>
                      {patient.is_convenio_patient && (
                        <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full mt-1">
                          Convênio
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Documents List */}
        <div className="lg:col-span-2">
          {selectedPatient ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Documentos de {selectedPatient.name}</h2>
                  <p className="text-sm text-gray-500">CPF: {formatCpf(selectedPatient.cpf)}</p>
                </div>
                
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn btn-primary flex items-center"
                  disabled={!signatureUrl}
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Novo Documento
                </button>
              </div>

              {!signatureUrl && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                  <div className="flex items-center">
                    <Signature className="h-5 w-5 text-yellow-600 mr-2" />
                    <p className="text-yellow-700">
                      Você precisa cadastrar sua assinatura digital para gerar documentos.
                    </p>
                  </div>
                </div>
              )}

              {documents.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhum documento encontrado
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Este paciente ainda não possui documentos gerados.
                  </p>
                  {signatureUrl && (
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="btn btn-primary inline-flex items-center"
                    >
                      <Plus className="h-5 w-5 mr-2" />
                      Criar Primeiro Documento
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {documents.map((document) => (
                    <div key={document.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <FileText className="h-5 w-5 text-gray-500 mr-2" />
                            <span className="font-medium">{document.template_name || getDocumentTypeLabel(document.type)}</span>
                          </div>
                          
                          <div className="flex items-center text-xs text-gray-500 mt-3">
                            <Calendar className="h-4 w-4 mr-1" />
                            <span>Gerado em: {formatDate(document.created_at)}</span>
                          </div>
                        </div>

                        <a
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-4 p-2 text-blue-600 hover:text-blue-800 transition-colors"
                          title="Baixar"
                        >
                          <Download className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-center py-12">
                <User className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Selecione um paciente
                </h3>
                <p className="text-gray-600">
                  Escolha um paciente da lista ao lado para visualizar ou gerar documentos.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Document Modal */}
      {showCreateModal && selectedPatient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Gerar Novo Documento</h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Documento
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="input mb-4"
                >
                  <option value="all">Todos os tipos</option>
                  <option value="atestado">Atestado Médico</option>
                  <option value="receituario">Receituário</option>
                  <option value="termo_consentimento">Termo de Consentimento</option>
                  <option value="lgpd">Termo LGPD</option>
                  <option value="solicitacao_exames">Solicitação de Exames</option>
                  <option value="declaracao_comparecimento">Declaração de Comparecimento</option>
                </select>

                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={handleTemplateChange}
                  className="input"
                  required
                >
                  <option value="">Selecione um template</option>
                  {getFilteredTemplates().map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTemplateId && (
                <div>
                  <h3 className="text-md font-semibold mb-3">Dados do Documento</h3>
                  
                  {getTemplateFields(selectedTemplateId).map((field) => (
                    <div key={field} className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </label>
                      {field.includes('prescricao') || field.includes('observacoes') || field.includes('exames') ? (
                        <textarea
                          value={formData[field] || ''}
                          onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                          className="input min-h-[100px]"
                          placeholder={`Digite ${field.replace(/_/g, ' ')}...`}
                        />
                      ) : (
                        <input
                          type={field.includes('data') ? 'date' : field.includes('hora') ? 'time' : 'text'}
                          value={formData[field] || ''}
                          onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                          className="input"
                          placeholder={`Digite ${field.replace(/_/g, ' ')}...`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateDocument}
                  className="btn btn-primary"
                  disabled={!selectedTemplateId || isLoading}
                >
                  {isLoading ? 'Gerando...' : 'Gerar Documento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Signature Modal */}
      {showSignatureModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Assinatura Digital</h2>
                <button
                  onClick={() => setShowSignatureModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="text-center mb-6">
                {signatureUrl ? (
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-2">Assinatura atual:</p>
                    <img 
                      src={signatureUrl} 
                      alt="Sua assinatura" 
                      className="max-w-full h-auto max-h-32 mx-auto border border-gray-200 p-2 rounded"
                    />
                  </div>
                ) : (
                  <div className="bg-gray-100 p-8 rounded-lg mb-4 flex items-center justify-center">
                    <Signature className="h-12 w-12 text-gray-400" />
                  </div>
                )}

                <p className="text-sm text-gray-600 mb-4">
                  Faça upload de uma imagem da sua assinatura para usar em documentos.
                </p>

                <label className="btn btn-primary flex items-center justify-center w-full cursor-pointer">
                  <Upload className="h-5 w-5 mr-2" />
                  {signatureUrl ? 'Atualizar Assinatura' : 'Fazer Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSignatureUpload}
                    className="hidden"
                    disabled={isUploadingSignature}
                  />
                </label>
              </div>

              {isUploadingSignature && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
                  <p className="text-sm text-gray-600 mt-2">Enviando assinatura...</p>
                </div>
              )}

              <div className="text-sm text-gray-500 mt-4">
                <p>Recomendações:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Use uma imagem com fundo transparente (PNG)</li>
                  <li>Resolução recomendada: 300-600 DPI</li>
                  <li>Tamanho máximo: 2MB</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;