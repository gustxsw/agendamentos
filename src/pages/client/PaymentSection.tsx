import React, { useState, useEffect } from 'react';
import { CreditCard, Calendar, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// MercadoPago SDK v2 declaration
declare global {
  interface Window {
    MercadoPago: any;
  }
}

type PaymentSectionProps = {
  userId: number;
  subscriptionStatus: string;
  subscriptionExpiry: string | null;
};

const PaymentSection: React.FC<PaymentSectionProps> = ({ 
  userId, 
  subscriptionStatus,
  subscriptionExpiry 
}) => {
  const [dependentCount, setDependentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Get API URL - PRODUCTION READY
  const getApiUrl = () => {
    if (window.location.hostname === 'www.cartaoquiroferreira.com.br' || 
        window.location.hostname === 'cartaoquiroferreira.com.br') {
      return 'https://www.cartaoquiroferreira.com.br';
    }
    
    return 'http://localhost:3001';
  };
  
  // Load MercadoPago SDK v2
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.type = 'text/javascript';
    script.onload = () => {
      const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
      console.log('🔥 MercadoPago SDK v2 loaded for client payment, Public Key:', publicKey ? 'Found' : 'Missing');
      
      if (publicKey && window.MercadoPago) {
        try {
          new window.MercadoPago(publicKey);
          console.log('✅ MercadoPago SDK v2 initialized successfully for client payment');
        } catch (error) {
          console.error('❌ Error initializing MercadoPago SDK v2:', error);
        }
      } else {
        console.warn('⚠️ MercadoPago public key not found or SDK not loaded');
      }
    };
    script.onerror = () => {
      console.error('❌ Failed to load MercadoPago SDK v2');
    };
    document.body.appendChild(script);
    
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);
  
  useEffect(() => {
    const fetchDependents = async () => {
      try {
        const token = localStorage.getItem('token');
        const apiUrl = getApiUrl();
        
        const response = await fetch(`${apiUrl}/api/dependents/${userId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          setDependentCount(data.length);
        }
      } catch (error) {
        console.error('Error fetching dependents:', error);
      }
    };
    
    fetchDependents();
  }, [userId]);
  
  // Handle payment with SDK v2
  const handlePayment = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();
      
      console.log('🔄 Creating client subscription payment with SDK v2...');
      
      const response = await fetch(`${apiUrl}/api/create-subscription`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          dependent_ids: [] // Will be populated with actual dependent IDs
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao criar pagamento');
      }
      
      const data = await response.json();
      console.log('✅ Client payment preference created with SDK v2:', data);
      
      // Redirect to MercadoPago with SDK v2
      window.location.href = data.init_point;
    } catch (error) {
      console.error('❌ Client payment error:', error);
      setError('Ocorreu um erro ao processar o pagamento');
    } finally {
      setIsLoading(false);
    }
  };
  
  const totalAmount = 250 + (dependentCount * 50); // R$250 titular + R$50 per dependent
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  };
  
  return (
    <div className="card mb-6">
      <div className="flex items-center mb-4">
        <CreditCard className="h-6 w-6 text-red-600 mr-2" />
        <h2 className="text-xl font-semibold">Assinatura</h2>
      </div>
      
      <div className="space-y-4">
        {subscriptionStatus === 'active' && subscriptionExpiry && (
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Calendar className="h-5 w-5 text-green-600 mr-2" />
              <p className="text-green-700 font-medium">
                Assinatura ativa até {formatDate(subscriptionExpiry)}
              </p>
            </div>
            <p className="text-sm text-green-600">
              Sua assinatura será renovada automaticamente.
            </p>
          </div>
        )}
        
        {(subscriptionStatus === 'pending' || subscriptionStatus === 'expired') && (
          <>
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-medium mb-2">Detalhes da Assinatura</h3>
              <div className="space-y-2">
                <p>Titular: R$ 250,00</p>
                {dependentCount > 0 && (
                  <p>Dependentes ({dependentCount}): R$ {dependentCount * 50},00</p>
                )}
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <p className="font-medium">Total: R$ {totalAmount},00</p>
                </div>
              </div>
            </div>
            
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center">
                <AlertCircle className="h-5 w-5 mr-2" />
                {error}
              </div>
            )}
            
            <button
              onClick={handlePayment}
              className={`btn btn-primary w-full ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? 'Processando...' : 'Realizar Pagamento'}
            </button>
            
            <p className="text-sm text-gray-600 text-center">
              O pagamento será processado de forma segura pelo Mercado Pago (SDK v2)
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentSection;