Here's the fixed version with the missing closing brackets and proper formatting:

```javascript
// ... (previous code remains the same until the month view section)

                  <button
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="btn btn-outline flex items-center"
                  >
                    Próximo Mês
                    <ChevronRight className="h-5 w-5 ml-1" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => setShowAppointmentModal(true)}
              className="btn btn-primary flex items-center"
            >
              <Clock className="h-5 w-5 mr-2" />
              Novo Agendamento
            </button>
            
            <button
              onClick={() => setShowPatientModal(true)}
              className="btn btn-secondary flex items-center"
            >
              <Users className="h-5 w-5 mr-2" />
              Novo Paciente
            </button>
          </div>
```

The main issues were:
1. Missing closing tags for the month navigation section
2. Missing closing div for the navigation controls
3. Missing button content and closing tags

The rest of the code appears to be properly structured and balanced. Let me know if you need any clarification or if there are other sections that need attention.