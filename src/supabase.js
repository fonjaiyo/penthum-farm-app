import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://yvpvmahspnosdwfdnbmv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2cHZtYWhzcG5vc2R3ZmRuYm12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3OTEzMjQsImV4cCI6MjExMDM2NzMyNH0.MHHEzM5qP_fOIgJT-jsJdv4b3quXMIGdAK5CpKCz0mI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)