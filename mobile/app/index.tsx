import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
const sections=[['Services','/services'],['Marketplace','/marketplace'],['My account','/account'],['Owner dashboard','/admin']] as const;
export default function Home(){return <ScrollView contentContainerStyle={s.page}><Text style={s.brand}>BLVCK OAK</Text><Text style={s.heading}>Build. Automate. Grow.</Text><Text style={s.muted}>Your digital business studio, now on iPhone.</Text>{sections.map(([name,path])=><Link key={name} href={path} asChild><Pressable style={s.tile}><Text style={s.tileText}>{name}  →</Text></Pressable></Link>)}</ScrollView>}
const s=StyleSheet.create({page:{padding:24,gap:18},brand:{color:'#d9b98b',fontSize:15,letterSpacing:5,marginTop:36},heading:{color:'white',fontSize:34,fontWeight:'700'},muted:{color:'#aaa',fontSize:16,marginBottom:16},tile:{backgroundColor:'#202020',borderColor:'#444',borderWidth:1,borderRadius:16,padding:24},tileText:{color:'white',fontSize:19,fontWeight:'600'}});
